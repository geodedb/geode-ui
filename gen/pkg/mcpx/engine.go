package mcpx

import (
	"bufio"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"sync"
	"time"

	"geodedb.com/geode-ui/gen/pkg/gen"
	"geodedb.com/geode-ui/gen/pkg/obsx"
	"geodedb.com/geode-ui/gen/pkg/wsx"
)

// ErrInvalidRequest indicates a malformed JSON-RPC 2.0 request.
var ErrInvalidRequest = errors.New("mcpx: invalid request")

// ErrToolTimeout indicates a tool exceeded its allotted time.
var ErrToolTimeout = errors.New("mcpx: tool timeout")

// Tool is a function that takes the request-scoped context plus params as
// raw JSON and returns result JSON. The ctx carries any verifier-derived
// values (e.g. JWT claims) so tool bodies can read them natively rather
// than reaching for a per-goroutine stash. For STDIO the ctx is
// context.Background() (no per-request enrichment is possible there).
type Tool func(ctx context.Context, params jsontext.Value) (jsontext.Value, error)

// AuditMCP provides hooks for auth and tool-call events.
var AuditMCP = struct {
	AuthOK   func(transport, sub string)
	AuthFail func(transport, reason string)
	ToolCall func(name string)
}{
	AuthOK:   func(string, string) {},
	AuthFail: func(string, string) {},
	ToolCall: func(string) {},
}

// lightweight token bucket for per-tool rate limiting
type bucket struct {
	mu          sync.Mutex
	tokens      float64
	last        time.Time
	rate, burst float64
}

func (b *bucket) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	dt := now.Sub(b.last).Seconds()
	b.tokens += dt * b.rate
	if b.tokens > b.burst {
		b.tokens = b.burst
	}
	b.last = now
	if b.tokens >= 1 {
		b.tokens -= 1
		return true
	}
	return false
}

func (b *bucket) snapshot() (int, int, time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	limit := int(b.burst)
	remaining := int(b.tokens)
	reset := time.Now().Add(time.Second)
	return limit, remaining, reset
}

var toolBuckets map[string]*bucket
var toolTimeout = 5 * time.Second
var authVerifier func(*http.Request) (context.Context, error)
var wsOriginAllowlist []string
var wsAllowAnyOrigin bool

// DefaultMaxHTTPBodyBytes is the default per-request body cap that
// HandleHTTP enforces via io.LimitReader. Mirrors the route-level
// MaxBytesReader cap in genapi's emitted /mcp wrapper. APPSEC-1.
const DefaultMaxHTTPBodyBytes int64 = 1 << 20

var maxHTTPBodyBytes int64 = DefaultMaxHTTPBodyBytes

// MaxHTTPBodyBytes reports the current body cap for HandleHTTP.
// APPSEC-1.
func MaxHTTPBodyBytes() int64 { return maxHTTPBodyBytes }

// SetMaxHTTPBodyBytes configures the per-request body cap that
// HandleHTTP applies to incoming JSON-RPC requests. Set to 0 to
// disable the cap (operators that have already wrapped the route at
// a higher layer may opt out, but doing so is discouraged because it
// re-opens the unbounded io.ReadAll DoS path that motivated this
// finding). APPSEC-1.
func SetMaxHTTPBodyBytes(n int64) { maxHTTPBodyBytes = n }

// SetToolBuckets configures per-tool rate limiting buckets.
func SetToolBuckets(tools map[string]Tool, rate, burst float64) {
	toolBuckets = BuildToolBuckets(tools, rate, burst)
}

// SetToolTimeout sets the per-tool timeout for execution.
func SetToolTimeout(d time.Duration) { toolTimeout = d }

// SetAuthVerifier configures MCP request authentication verification.
// On success the verifier returns the request-scoped context to thread
// into tool bodies (e.g. r.Context() after a JWT middleware has stashed
// claims on it); on failure it returns (nil, err) and the request is
// rejected with HTTP 401 before any dispatch. When unset,
// HandleHTTP/ServeWS fail closed.
func SetAuthVerifier(v func(*http.Request) (context.Context, error)) { authVerifier = v }

// SetWSOriginAllowlist configures allowed Origin values for MCP WebSocket
// upgrades. SEC-0008: an empty list now means fail-closed under
// UpgradeStrict — every upgrade is rejected with HTTP 403 unless
// SetWSAllowAnyOrigin(true) has been called. The legacy "empty list
// disables origin checks" behaviour was a fail-open default that
// allowed cross-origin WS hijack on the privileged MCP surface.
func SetWSOriginAllowlist(origins []string) {
	if len(origins) == 0 {
		wsOriginAllowlist = nil
		return
	}
	cpy := make([]string, len(origins))
	copy(cpy, origins)
	wsOriginAllowlist = cpy
}

// auditConfigChange dispatches package-config audit events. The
// indirection lets tests intercept emissions without depending on
// obsx's stdout JSON path. APPSEC-14.
var auditConfigChange = obsx.LogAudit

// SetWSAllowAnyOrigin toggles the explicit "any origin" override for
// MCP WebSocket upgrades. SEC-0008: callers MUST opt in by passing
// true to bypass the fail-closed allowlist gate. Intended for STDIO-
// adjacent or non-browser deployments where origin policing is not
// the right protection. Defaults to false.
//
// APPSEC-14: every false → true and true → false transition is
// recorded as a structured audit event so a misconfiguration leaves
// a forensic trail. Idempotent calls (no transition) are silent so
// config-reload callers do not flood the audit log.
func SetWSAllowAnyOrigin(allow bool) {
	prev := wsAllowAnyOrigin
	wsAllowAnyOrigin = allow
	switch {
	case !prev && allow:
		auditConfigChange("mcp_ws_allow_any_origin_enabled", map[string]any{
			"warning": "SEC-0008 fail-closed gate disabled; all WS upgrades will accept any Origin header value",
		})
	case prev && !allow:
		auditConfigChange("mcp_ws_allow_any_origin_disabled", map[string]any{
			"info": "SEC-0008 fail-closed gate re-enabled; WS upgrades fall back to OriginAllowlist enforcement",
		})
	}
}

// BuildToolBuckets constructs default buckets for tools.
func BuildToolBuckets(tools map[string]Tool, rate, burst float64) map[string]*bucket {
	m := make(map[string]*bucket, len(tools))
	for k := range tools {
		m[k] = &bucket{tokens: burst, last: time.Now(), rate: rate, burst: burst}
	}
	return m
}

// HandleHTTP implements JSON-RPC 2.0 over HTTP, including single, batch, and notifications.
func HandleHTTP(w http.ResponseWriter, r *http.Request, tools map[string]Tool) {
	id := obsx.RequestIDFrom(r)
	if authVerifier == nil {
		AuditMCP.AuthFail("http", "missing verifier")
		obsx.LogAudit("mcp_auth_fail", map[string]any{"transport": "http", "id": id, "reason": "missing verifier"})
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	ctx, err := authVerifier(r)
	if err != nil {
		AuditMCP.AuthFail("http", "missing auth")
		obsx.LogAudit("mcp_auth_fail", map[string]any{"transport": "http", "id": id, "reason": "missing auth"})
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if ctx == nil {
		ctx = r.Context()
	}
	AuditMCP.AuthOK("http", "")
	obsx.LogAudit("mcp_auth_ok", map[string]any{"transport": "http", "id": id})
	w.Header().Set("Content-Type", "application/json")

	body, err := readBoundedBody(r.Body, maxHTTPBodyBytes)
	if err != nil {
		switch err {
		case errBodyTooLarge:
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			_ = json.MarshalWrite(w, objErr(nil, -32600, "request body too large"))
		default:
			w.WriteHeader(http.StatusBadRequest)
			_ = json.MarshalWrite(w, objErr(nil, -32600, "invalid request"))
		}
		return
	}
	dispatchHTTP(ctx, w, body, tools)
}

// errBodyTooLarge is returned by readBoundedBody when a request body
// strictly exceeds the configured cap. Distinct sentinel so HandleHTTP
// can map it to HTTP 413 rather than the generic 400.
var errBodyTooLarge = errors.New("mcpx: request body exceeds limit")

// readBoundedBody streams r through io.LimitReader with cap+1 bytes so
// any read returning more than cap bytes signals a violation. A cap
// value of 0 or negative disables bounding (legacy behaviour;
// discouraged because of CWE-770). APPSEC-1.
func readBoundedBody(r io.Reader, cap int64) ([]byte, error) {
	if cap <= 0 {
		return io.ReadAll(r)
	}
	body, err := io.ReadAll(io.LimitReader(r, cap+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > cap {
		return nil, errBodyTooLarge
	}
	return body, nil
}

// dispatchHTTP variant of dispatch that sets http.StatusBadRequest for
// malformed top-level JSON. Splitting from dispatch lets the STDIO/WS
// paths stay header-agnostic.
func dispatchHTTP(ctx context.Context, w http.ResponseWriter, body []byte, tools map[string]Tool) {
	if ctx == nil {
		ctx = context.Background()
	}
	trimmed := bytesTrimSpace(body)
	if len(trimmed) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.MarshalWrite(w, objErr(nil, -32600, "invalid request"))
		return
	}
	switch trimmed[0] {
	case '{':
		env, err := decodeEnvelope(trimmed)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.MarshalWrite(w, objErr(nil, -32600, "invalid request"))
			return
		}
		if env.Method == "tools/call" {
			if name := extractToolNameRaw(env.Params); name != "" {
				if bk, ok := toolBuckets[name]; ok {
					lim, rem, reset := bk.snapshot()
					setRateHeaders(w, lim, rem, reset)
				}
			}
		}
		res := handleRaw(ctx, env, tools, toolBuckets)
		if res == nil {
			// notification: legacy behavior writes "null"
			_, _ = w.Write([]byte("null"))
			return
		}
		_ = json.MarshalWrite(w, res)
	case '[':
		var batch []jsontext.Value
		if err := json.Unmarshal(trimmed, &batch); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.MarshalWrite(w, objErr(nil, -32600, "invalid request"))
			return
		}
		out := make([]any, 0, len(batch))
		for _, raw := range batch {
			env, err := decodeEnvelope(raw)
			if err != nil {
				continue
			}
			res := handleRaw(ctx, env, tools, toolBuckets)
			if res != nil {
				out = append(out, res)
			}
		}
		_ = json.MarshalWrite(w, out)
	default:
		w.WriteHeader(http.StatusBadRequest)
		_ = json.MarshalWrite(w, objErr(nil, -32600, "invalid request"))
	}
}

// ServeWS upgrades to WS and serves JSON-RPC 2.0 messages bidirectionally (simple text frames JSON).
func ServeWS(w http.ResponseWriter, r *http.Request, tools map[string]Tool) {
	id := obsx.RequestIDFrom(r)
	if authVerifier == nil {
		AuditMCP.AuthFail("ws", "missing verifier")
		obsx.LogAudit("mcp_auth_fail", map[string]any{"transport": "ws", "id": id, "reason": "missing verifier"})
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	ctx, err := authVerifier(r)
	if err != nil {
		AuditMCP.AuthFail("ws", "missing auth")
		obsx.LogAudit("mcp_auth_fail", map[string]any{"transport": "ws", "id": id, "reason": "missing auth"})
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if ctx == nil {
		ctx = r.Context()
	}
	AuditMCP.AuthOK("ws", "")
	obsx.LogAudit("mcp_auth_ok", map[string]any{"transport": "ws", "id": id})
	// SEC-0008: UpgradeStrict fails closed when wsOriginAllowlist is
	// empty/nil unless wsAllowAnyOrigin was explicitly enabled. The
	// MCP WS surface is privileged; browser-side cross-origin hijack
	// is unacceptable, so we never want the legacy fail-open default.
	conn, err := wsx.UpgradeStrict(w, r, wsx.Options{
		OriginAllowlist: wsOriginAllowlist,
		AllowAnyOrigin:  wsAllowAnyOrigin,
		MaxFrame:        1 << 20,
		MaxMessage:      1 << 20,
	})
	if err != nil {
		// UpgradeStrict has already written the 403 response on
		// origin failures; only the protocol-error path needs an
		// explicit 400 here.
		if !errors.Is(err, wsx.ErrOriginNotAllowed) {
			w.WriteHeader(http.StatusBadRequest)
		}
		return
	}
	defer func() { _ = conn.Close() }()
	for {
		op, msg, err := conn.ReadMessage()
		if err != nil || op == 0x8 {
			return
		}
		if op != 0x1 {
			continue
		}
		trimmed := bytesTrimSpace(msg)
		if len(trimmed) == 0 || trimmed[0] != '{' {
			// WS only handles single requests (no batch in this transport).
			_ = conn.WriteMessage(0x1, []byte(`{"jsonrpc":"2.0","error":{"code":-32600,"message":"invalid request"}}`))
			continue
		}
		env, e := decodeEnvelope(trimmed)
		if e != nil {
			_ = conn.WriteMessage(0x1, []byte(`{"jsonrpc":"2.0","error":{"code":-32600,"message":"invalid request"}}`))
			continue
		}
		res := handleRaw(ctx, env, tools, toolBuckets)
		if res == nil {
			continue
		}
		b, _ := json.Marshal(res)
		_ = conn.WriteMessage(0x1, b)
	}
}

// ServeSTDIO runs a JSON-RPC 2.0 loop over stdin/stdout for MCP.
func ServeSTDIO(tools map[string]Tool) error {
	return serveSTDIOWith(os.Stdin, os.Stdout, tools)
}

// serveSTDIOWith is an internal helper to enable tests with pipes.
// STDIO has no per-request enrichment hook, so tool bodies receive
// context.Background(). This is the fail-safe default: a tool that
// expects a verifier-derived value will see the zero value rather
// than another request's leaked context.
func serveSTDIOWith(in io.Reader, out io.Writer, tools map[string]Tool) error {
	ctx := context.Background()
	br := bufio.NewReader(in)
	for {
		line, err := br.ReadBytes('\n')
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
		trimmed := bytesTrimSpace(line)
		if len(trimmed) == 0 {
			_ = json.MarshalWrite(out, objErr(nil, -32600, "invalid request"))
			_, _ = out.Write([]byte("\n"))
			continue
		}
		switch trimmed[0] {
		case '{':
			env, e := decodeEnvelope(trimmed)
			if e != nil {
				_ = json.MarshalWrite(out, objErr(nil, -32600, "invalid request"))
				_, _ = out.Write([]byte("\n"))
				continue
			}
			res := handleRaw(ctx, env, tools, toolBuckets)
			if res == nil { // notification
				_, _ = out.Write([]byte("null\n"))
				continue
			}
			_ = json.MarshalWrite(out, res)
			_, _ = out.Write([]byte("\n"))
		case '[':
			var batch []jsontext.Value
			if e := json.Unmarshal(trimmed, &batch); e != nil {
				_ = json.MarshalWrite(out, objErr(nil, -32600, "invalid request"))
				_, _ = out.Write([]byte("\n"))
				continue
			}
			outArr := make([]any, 0, len(batch))
			for _, raw := range batch {
				env, e := decodeEnvelope(raw)
				if e != nil {
					continue
				}
				res := handleRaw(ctx, env, tools, toolBuckets)
				if res != nil {
					outArr = append(outArr, res)
				}
			}
			_ = json.MarshalWrite(out, outArr)
			_, _ = out.Write([]byte("\n"))
		default:
			_ = json.MarshalWrite(out, objErr(nil, -32600, "invalid request"))
			_, _ = out.Write([]byte("\n"))
		}
	}
}

func bytesTrimSpace(b []byte) []byte {
	i := 0
	for i < len(b) && (b[i] == ' ' || b[i] == '\t' || b[i] == '\r' || b[i] == '\n') {
		i++
	}
	j := len(b) - 1
	for j >= i && (b[j] == ' ' || b[j] == '\t' || b[j] == '\r' || b[j] == '\n') {
		j--
	}
	return b[i : j+1]
}

// rawEnvelope is the minimally-decoded JSON-RPC 2.0 request envelope.
// id and params are kept as raw jsontext.Value so the dispatcher can
// splice them back into the response (id) and forward them to a tool
// (params) without an intermediate any/map round-trip. See PERF-0041.
type rawEnvelope struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      jsontext.Value `json:"id,omitzero"`
	Method  string         `json:"method"`
	Params  jsontext.Value `json:"params,omitzero"`
}

// rawToolCall is the minimally-decoded params payload for tools/call.
// The inner Params is forwarded to the tool unchanged.
type rawToolCall struct {
	Name   string         `json:"name"`
	Params jsontext.Value `json:"params,omitzero"`
}

// decodeEnvelope parses a single JSON-RPC 2.0 request into rawEnvelope.
// It does not validate the protocol version; that is the caller's job.
func decodeEnvelope(raw jsontext.Value) (*rawEnvelope, error) {
	env := &rawEnvelope{}
	if err := json.Unmarshal(raw, env); err != nil {
		return nil, err
	}
	return env, nil
}

// extractToolNameRaw reads only the "name" field from a raw tools/call
// params payload without decoding the inner params bytes. Returns ""
// for malformed/missing inputs.
func extractToolNameRaw(params jsontext.Value) string {
	if len(params) == 0 {
		return ""
	}
	var p struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return ""
	}
	return p.Name
}

// rpcResultEnvelope is the success-response envelope written for
// non-tools/call paths. result is set as a Go value (map/slice/etc).
type rpcResultEnvelope struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      jsontext.Value `json:"id"`
	Result  any            `json:"result"`
}

// rpcRawResultEnvelope writes a tools/call success response by splicing
// the tool's raw jsontext.Value result back in unchanged. This avoids
// the post-call json.Unmarshal(out, &v) round-trip that PERF-0041
// targeted.
type rpcRawResultEnvelope struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      jsontext.Value `json:"id"`
	Result  jsontext.Value `json:"result"`
}

// rpcErrEnvelope is the error-response envelope.
type rpcErrEnvelope struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      jsontext.Value `json:"id"`
	Error   rpcErrPayload  `json:"error"`
}

type rpcErrPayload struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// handleRaw is the single-request dispatcher operating on a
// minimally-decoded envelope. Returns nil for notifications.
func handleRaw(ctx context.Context, env *rawEnvelope, tools map[string]Tool, buckets map[string]*bucket) any {
	if ctx == nil {
		ctx = context.Background()
	}
	if env.JSONRPC != "2.0" {
		return objErrRaw(env.ID, -32600, "invalid request")
	}
	// Notifications have no id field. jsontext.Value zero-length means
	// the id key was absent or set to null/undefined.
	if isNullID(env.ID) {
		return nil
	}
	switch env.Method {
	case "initialize":
		return objResRaw(env.ID, map[string]any{"capabilities": map[string]any{}})
	case "ping":
		return objResRaw(env.ID, map[string]any{"ok": true})
	case "shutdown":
		return objResRaw(env.ID, map[string]any{"ok": true})
	case "tools/list":
		list := make([]string, 0, len(tools))
		for k := range tools {
			list = append(list, k)
		}
		sort.Strings(list)
		return objResRaw(env.ID, map[string]any{"tools": list})
	case "tools/call":
		var call rawToolCall
		if len(env.Params) > 0 {
			if err := json.Unmarshal(env.Params, &call); err != nil {
				return objErrRaw(env.ID, -32602, "invalid params")
			}
		}
		if call.Name == "" {
			return objErrRaw(env.ID, -32602, "invalid params")
		}
		fn, ok := tools[call.Name]
		if !ok {
			return objErrRaw(env.ID, -32601, "method not found")
		}
		if buckets != nil {
			if bk, ok := buckets[call.Name]; ok && !bk.allow() {
				return objErrRaw(env.ID, -32000, "rate limited")
			}
		}
		AuditMCP.ToolCall(call.Name)
		obsx.LogAudit("mcp_tool_call", map[string]any{"tool": call.Name})
		timeoutCtx, cancel := context.WithTimeout(ctx, toolTimeout)
		defer cancel()
		ch := make(chan struct {
			out jsontext.Value
			err error
		}, 1)
		gen.SafeGo("mcp-tool-exec", func() {
			o, e := fn(timeoutCtx, call.Params)
			ch <- struct {
				out jsontext.Value
				err error
			}{o, e}
		})
		var out jsontext.Value
		var err error
		select {
		case res := <-ch:
			out = res.out
			err = res.err
		case <-timeoutCtx.Done():
			return objErrRaw(env.ID, -32000, ErrToolTimeout.Error())
		}
		if err != nil {
			return objErrRaw(env.ID, -32000, err.Error())
		}
		obsx.LogAudit("mcp_tool_result", map[string]any{"tool": call.Name})
		// Splice raw result bytes directly into the envelope so the
		// outer MarshalWrite emits them verbatim. If the tool returned
		// no bytes, encode an explicit JSON null to keep wire format.
		if len(out) == 0 {
			out = jsontext.Value("null")
		}
		return &rpcRawResultEnvelope{JSONRPC: "2.0", ID: cloneID(env.ID), Result: out}
	default:
		return objErrRaw(env.ID, -32601, "method not found")
	}
}

// isNullID reports whether the JSON-RPC id field was absent or null,
// indicating a notification. We treat a present-but-null id as a
// notification per legacy behavior (handleOne returned nil when m["id"]
// was nil).
func isNullID(v jsontext.Value) bool {
	if len(v) == 0 {
		return true
	}
	t := bytesTrimSpace(v)
	return len(t) == 4 && string(t) == "null"
}

// cloneID copies the id bytes so subsequent reuse of the request buffer
// can't mutate the response.
func cloneID(v jsontext.Value) jsontext.Value {
	if len(v) == 0 {
		return jsontext.Value("null")
	}
	out := make(jsontext.Value, len(v))
	copy(out, v)
	return out
}

func objResRaw(id jsontext.Value, result any) *rpcResultEnvelope {
	return &rpcResultEnvelope{JSONRPC: "2.0", ID: cloneID(id), Result: result}
}

func objErrRaw(id jsontext.Value, code int, msg string) *rpcErrEnvelope {
	return &rpcErrEnvelope{
		JSONRPC: "2.0",
		ID:      cloneID(id),
		Error:   rpcErrPayload{Code: code, Message: msg},
	}
}

// objErr is the parse-failure error envelope used when the request
// body cannot be decoded enough to recover an id field. It always uses
// id=null per JSON-RPC 2.0.
func objErr(id any, code int, msg string) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": msg}}
}

// Helpers for HTTP rate headers
func setRateHeaders(w http.ResponseWriter, limit, remaining int, reset time.Time) {
	w.Header().Set("X-RateLimit-Limit", itoa(limit))
	w.Header().Set("X-RateLimit-Remaining", itoa(remaining))
	w.Header().Set("X-RateLimit-Reset", fmtUnix(reset))
}

func itoa(v int) string          { return strconv.Itoa(v) }
func fmtUnix(t time.Time) string { return strconv.FormatInt(t.Unix(), 10) }
