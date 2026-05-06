package gqlx

import (
	"bytes"
	"encoding/json/v2"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"geodedb.com/geode-ui/gen/pkg/gen"
)

// HandlerOptions configures the GraphQL HTTP handler's security and
// operational limits.
type HandlerOptions struct {
	Timeout       time.Duration
	MaxQueryBytes int
	MaxBatchSize  int
	MaxDepth      int
	MaxComplexity int
	MaxAliases    int
}

// Handler serves GraphQL queries over HTTP GET and POST. It implements
// http.Handler and supports single requests as well as batch requests
// (JSON arrays).
type Handler struct {
	schema *Schema
	opts   HandlerOptions
}

// NewHandler creates a Handler for the given schema, applying sensible
// defaults for any zero-valued option fields.
func NewHandler(schema *Schema, opts HandlerOptions) *Handler {
	if opts.Timeout == 0 {
		opts.Timeout = 5 * time.Second
	}
	if opts.MaxQueryBytes == 0 {
		opts.MaxQueryBytes = 1 << 20 // 1 MB
	}
	if opts.MaxBatchSize == 0 {
		opts.MaxBatchSize = 10
	}
	if opts.MaxDepth == 0 {
		opts.MaxDepth = 10
	}
	if opts.MaxComplexity == 0 {
		opts.MaxComplexity = 100
	}
	if opts.MaxAliases == 0 {
		opts.MaxAliases = 10
	}
	return &Handler{schema: schema, opts: opts}
}

// gqlRequest is the JSON envelope for a single GraphQL request.
type gqlRequest struct {
	Query         string         `json:"query"`
	Variables     map[string]any `json:"variables"`
	OperationName string         `json:"operationName"`
}

// validateOpts returns the ValidateOptions derived from the handler's
// configuration.
func (h *Handler) validateOpts() ValidateOptions {
	return ValidateOptions{
		MaxDepth:      h.opts.MaxDepth,
		MaxComplexity: h.opts.MaxComplexity,
		MaxAliases:    h.opts.MaxAliases,
	}
}

// ServeHTTP dispatches GraphQL requests. GET requests read query
// parameters; POST requests read a JSON body. Batch requests (JSON
// arrays) are supported for POST only.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.handleGET(w, r)
	case http.MethodPost:
		h.handlePOST(w, r)
	default:
		http.Error(w, `{"errors":[{"message":"method not allowed"}]}`, http.StatusMethodNotAllowed)
	}
}

// handleGET extracts the query, variables, and operationName from URL
// query parameters and executes a single request.
func (h *Handler) handleGET(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("query")
	if len(query) > h.opts.MaxQueryBytes {
		writeJSONError(w, http.StatusBadRequest, ErrQueryTooLarge.Error())
		return
	}

	var variables map[string]any
	if v := r.URL.Query().Get("variables"); v != "" {
		if err := json.Unmarshal([]byte(v), &variables); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid variables JSON")
			return
		}
	}

	operationName := r.URL.Query().Get("operationName")

	resp := Execute(r.Context(), h.schema, query, variables, operationName, h.opts.Timeout, h.validateOpts())
	writeJSON(w, http.StatusOK, resp)
}

// handlePOST reads the JSON body, detects single vs batch requests, and
// executes accordingly.
func (h *Handler) handlePOST(w http.ResponseWriter, r *http.Request) {
	ct := r.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "application/json") {
		http.Error(w, `{"errors":[{"message":"unsupported media type"}]}`, http.StatusUnsupportedMediaType)
		return
	}

	// Read at most MaxQueryBytes+1 to detect oversized bodies.
	limit := int64(h.opts.MaxQueryBytes) + 1
	body, err := io.ReadAll(io.LimitReader(r.Body, limit))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "failed to read request body")
		return
	}
	if len(body) > h.opts.MaxQueryBytes {
		writeJSONError(w, http.StatusBadRequest, ErrQueryTooLarge.Error())
		return
	}

	// Detect batch vs single by looking at the first non-whitespace byte
	// without converting the entire body to string.
	if b, ok := firstNonWSByte(body); ok && b == '[' {
		h.handleBatch(w, r, body)
		return
	}

	var req gqlRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	execReq := cloneRequestWithBody(r, body)
	resp := Execute(ContextWithRequest(r.Context(), execReq), h.schema, req.Query, req.Variables, req.OperationName, h.opts.Timeout, h.validateOpts())
	writeJSON(w, http.StatusOK, resp)
}

// handleBatch processes a JSON array of GraphQL requests.
func (h *Handler) handleBatch(w http.ResponseWriter, r *http.Request, body []byte) {
	var reqs []gqlRequest
	if err := json.Unmarshal(body, &reqs); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid batch JSON")
		return
	}

	if len(reqs) > h.opts.MaxBatchSize {
		writeJSONError(w, http.StatusBadRequest, ErrBatchLimitExceeded.Error())
		return
	}

	results := make([]*Response, len(reqs))
	var wg sync.WaitGroup
	for i, req := range reqs {
		wg.Add(1)
		gen.SafeGo("gql-batch-exec", func() {
			defer wg.Done()
			execReq := cloneRequestWithBody(r, body)
			results[i] = Execute(ContextWithRequest(r.Context(), execReq), h.schema, req.Query, req.Variables, req.OperationName, h.opts.Timeout, h.validateOpts())
		})
	}
	wg.Wait()

	writeJSON(w, http.StatusOK, results)
}

// writeJSON marshals v as JSON and writes it to w with the given status
// code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.MarshalWrite(w, v)
}

// writeJSONError writes a GraphQL-shaped error response.
func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	resp := Response{
		Errors: []*GQLError{{Message: msg}},
	}
	_ = json.MarshalWrite(w, resp)
}

func firstNonWSByte(b []byte) (byte, bool) {
	for _, ch := range b {
		switch ch {
		case ' ', '\t', '\r', '\n':
			continue
		default:
			return ch, true
		}
	}
	return 0, false
}

func cloneRequestWithBody(r *http.Request, body []byte) *http.Request {
	clone := r.Clone(r.Context())
	clone.Body = io.NopCloser(bytes.NewReader(body))
	clone.ContentLength = int64(len(body))
	return clone
}
