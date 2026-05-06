package mcpx

import (
	"bytes"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHTTP_JSONRPC_SingleAndBatch(t *testing.T) {
	installHeaderAuthVerifier(t)
	tools := map[string]Tool{
		"echo": func(p jsontext.Value) (jsontext.Value, error) {
			var in struct {
				Msg string `json:"msg"`
			}
			_ = json.Unmarshal(p, &in)
			out := struct{ Msg string }{in.Msg}
			return json.Marshal(out)
		},
	}
	srv := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { HandleHTTP(w, r, tools) })
	// single
	one := map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "echo", "params": map[string]any{"msg": "hi"}}}
	b, _ := json.Marshal(one)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/mcp", bytes.NewReader(b))
	r.Header.Set("Authorization", "Bearer x")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("code %d", w.Code)
	}
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	res, ok := out["result"].(map[string]any)
	if !ok {
		t.Fatalf("unexpected result type: %#v", out)
	}
	if msg, _ := res["Msg"].(string); msg != "hi" {
		t.Fatalf("unexpected: %#v", out)
	}
	// batch
	arr := []any{one, one}
	b, _ = json.Marshal(arr)
	r = httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/mcp", bytes.NewReader(b))
	r.Header.Set("Authorization", "Bearer x")
	w = httptest.NewRecorder()
	srv.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("code %d", w.Code)
	}
}

func TestHTTP_JSONRPC_Notification(t *testing.T) {
	installHeaderAuthVerifier(t)
	tools := map[string]Tool{}
	srv := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { HandleHTTP(w, r, tools) })
	note := map[string]any{"jsonrpc": "2.0", "method": "tools/list", "params": map[string]any{}}
	b, _ := json.Marshal(note)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/mcp", bytes.NewReader(b))
	r.Header.Set("Authorization", "Bearer x")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("code %d", w.Code)
	}
	// notifications return null body in this implementation
	if strings.TrimSpace(w.Body.String()) != "null" {
		t.Fatalf("expected null, got %q", w.Body.String())
	}
}

func TestHTTP_JSONRPC_RateHeadersAndTimeout(t *testing.T) {
	installHeaderAuthVerifier(t)
	tools := map[string]Tool{
		"slow": func(p jsontext.Value) (jsontext.Value, error) {
			time.Sleep(50 * time.Millisecond)
			return json.Marshal(struct{ Ok bool }{true})
		},
	}
	SetToolBuckets(tools, 100, 20)
	SetToolTimeout(10 * time.Millisecond)
	srv := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { HandleHTTP(w, r, tools) })
	req := map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "slow", "params": map[string]any{}}}
	b, _ := json.Marshal(req)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/mcp", bytes.NewReader(b))
	r.Header.Set("Authorization", "Bearer x")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, r)
	if w.Header().Get("X-RateLimit-Limit") == "" || w.Header().Get("X-RateLimit-Remaining") == "" || w.Header().Get("X-RateLimit-Reset") == "" {
		t.Fatalf("rate headers missing")
	}
	if w.Code != 200 {
		t.Fatalf("code %d", w.Code)
	}
}

func TestHTTP_JSONRPC_ErrorPaths_HeadersPresence(t *testing.T) {
	installHeaderAuthVerifier(t)
	tools := map[string]Tool{
		"echo": func(p jsontext.Value) (jsontext.Value, error) { return p, nil },
	}
	SetToolBuckets(tools, 10, 5)
	srv := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { HandleHTTP(w, r, tools) })
	// Known tool -> headers present
	okReq := map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "echo", "params": map[string]any{"msg": "x"}}}
	b, _ := json.Marshal(okReq)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/mcp", bytes.NewReader(b))
	r.Header.Set("Authorization", "Bearer x")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, r)
	if w.Header().Get("X-RateLimit-Limit") == "" {
		t.Fatalf("expected rate headers for known tool")
	}
	// Unknown tool -> headers absent
	badReq := map[string]any{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": map[string]any{"name": "unknown", "params": map[string]any{}}}
	b, _ = json.Marshal(badReq)
	r = httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/mcp", bytes.NewReader(b))
	r.Header.Set("Authorization", "Bearer x")
	w = httptest.NewRecorder()
	srv.ServeHTTP(w, r)
	if w.Header().Get("X-RateLimit-Limit") != "" {
		t.Fatalf("did not expect rate headers for unknown tool")
	}
	// Invalid params (missing name) -> headers absent
	inv := map[string]any{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": map[string]any{"params": map[string]any{}}}
	b, _ = json.Marshal(inv)
	r = httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/mcp", bytes.NewReader(b))
	r.Header.Set("Authorization", "Bearer x")
	w = httptest.NewRecorder()
	srv.ServeHTTP(w, r)
	if w.Header().Get("X-RateLimit-Limit") != "" {
		t.Fatalf("did not expect rate headers for invalid params")
	}
}
