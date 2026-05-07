package gqlx

import (
	"bytes"
	"context"
	"encoding/json/v2"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func handlerSchema() *Schema {
	s := NewSchema()
	s.Query.AddField("hello", FieldDef{
		Type: TypeString,
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			return "world", nil
		},
	})
	s.Query.AddField("echo", FieldDef{
		Type: TypeString,
		Args: []ArgDef{{Name: "msg", Type: TypeString, Required: true}},
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			return args["msg"], nil
		},
	})
	s.Mutation.AddField("setVal", FieldDef{
		Type: TypeString,
		Args: []ArgDef{{Name: "v", Type: TypeString, Required: true}},
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			return args["v"], nil
		},
	})
	return s
}

func TestHandlerPOST(t *testing.T) {
	h := NewHandler(handlerSchema(), HandlerOptions{Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 5})
	body := `{"query":"{ hello }"}`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("status %d, body: %s", w.Code, w.Body.String())
	}
	var resp Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatal("expected map data")
	}
	if data["hello"] != "world" {
		t.Errorf("got %v", data["hello"])
	}
}

func TestHandlerGET(t *testing.T) {
	h := NewHandler(handlerSchema(), HandlerOptions{Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 5})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/graphql?query=%7B+hello+%7D", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("status %d, body: %s", w.Code, w.Body.String())
	}
}

func TestHandlerBatchLimit(t *testing.T) {
	h := NewHandler(handlerSchema(), HandlerOptions{Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 2})
	batch := `[{"query":"{ hello }"},{"query":"{ hello }"},{"query":"{ hello }"}]`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewBufferString(batch))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandlerQueryTooLarge(t *testing.T) {
	h := NewHandler(handlerSchema(), HandlerOptions{Timeout: 5 * time.Second, MaxQueryBytes: 10, MaxBatchSize: 5})
	body := `{"query":"{ hello_this_is_a_very_long_query }"}`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandlerMethodNotAllowed(t *testing.T) {
	h := NewHandler(handlerSchema(), HandlerOptions{Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 5})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPut, "/graphql", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

func TestHandlerBadContentType(t *testing.T) {
	h := NewHandler(handlerSchema(), HandlerOptions{Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 5})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewBufferString("not json"))
	req.Header.Set("Content-Type", "text/plain")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected 415, got %d", w.Code)
	}
}

func TestHandlerWithVariables(t *testing.T) {
	h := NewHandler(handlerSchema(), HandlerOptions{Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 5})
	body := `{"query":"query($m: String!) { echo(msg: $m) }","variables":{"m":"test"}}`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("status %d, body: %s", w.Code, w.Body.String())
	}
	var resp Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatal("expected map data")
	}
	if data["echo"] != "test" {
		t.Errorf("got %v", data["echo"])
	}
}

func TestHandlerGETQueryTooLarge(t *testing.T) {
	h := NewHandler(handlerSchema(), HandlerOptions{Timeout: 5 * time.Second, MaxQueryBytes: 10, MaxBatchSize: 5})
	// The query parameter exceeds the 10-byte limit.
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/graphql?query=%7B+hello_this_is_too_long+%7D", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	var resp Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(resp.Errors) == 0 || resp.Errors[0].Message != ErrQueryTooLarge.Error() {
		t.Errorf("expected ErrQueryTooLarge error, got %v", resp.Errors)
	}
}

func TestHandlerBatchConcurrent(t *testing.T) {
	s := NewSchema()
	s.Query.AddField("slow", FieldDef{
		Type: TypeString,
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			time.Sleep(50 * time.Millisecond)
			return "done", nil
		},
	})
	h := NewHandler(s, HandlerOptions{Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 5})

	batch := `[{"query":"{ slow }"},{"query":"{ slow }"},{"query":"{ slow }"}]`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewBufferString(batch))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	start := time.Now()
	h.ServeHTTP(w, req)
	elapsed := time.Since(start)

	if w.Code != 200 {
		t.Fatalf("status %d, body: %s", w.Code, w.Body.String())
	}
	var results []Response
	if err := json.Unmarshal(w.Body.Bytes(), &results); err != nil {
		t.Fatal(err)
	}
	if len(results) != 3 {
		t.Fatalf("got %d results, want 3", len(results))
	}
	for i, r := range results {
		data, ok := r.Data.(map[string]any)
		if !ok {
			t.Fatal("expected map data")
		}
		if data["slow"] != "done" {
			t.Errorf("result[%d]: got %v", i, data["slow"])
		}
	}
	// Sequential would take ~150ms; concurrent should be ~50-70ms.
	if elapsed > 120*time.Millisecond {
		t.Errorf("batch took %v — expected concurrent execution under 120ms", elapsed)
	}
}

func TestHandlerBatchOK(t *testing.T) {
	h := NewHandler(handlerSchema(), HandlerOptions{Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 5})
	batch := `[{"query":"{ hello }"},{"query":"mutation { setVal(v: \"x\") }"}]`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewBufferString(batch))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("status %d", w.Code)
	}
	var results []Response
	if err := json.Unmarshal(w.Body.Bytes(), &results); err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 {
		t.Fatalf("got %d results, want 2", len(results))
	}
}

func TestHandlerPOSTPreservesRequestBodyForResolvers(t *testing.T) {
	s := NewSchema()
	s.Mutation.AddField("signedEcho", FieldDef{
		Type: TypeString,
		Args: []ArgDef{{Name: "msg", Type: TypeString, Required: true}},
		Resolve: func(ctx context.Context, _ map[string]any) (any, error) {
			req, ok := RequestFromContext(ctx)
			if !ok || req == nil {
				t.Fatal("missing request in resolver context")
			}
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("read resolver body: %v", err)
			}
			return string(body), nil
		},
	})

	h := NewHandler(s, HandlerOptions{Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 5})
	body := `{"query":"mutation($msg: String!) { signedEcho(msg: $msg) }","variables":{"msg":"hello"}}`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewBufferString(body))
	req = req.WithContext(ContextWithRequest(req.Context(), req))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, body: %s", w.Code, w.Body.String())
	}
	var resp Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatal("expected map data")
	}
	if got := data["signedEcho"]; got != body {
		t.Fatalf("resolver saw %q, want %q", got, body)
	}
}
