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
)

type ctxKeyType struct{}

var ctxSentinelKey ctxKeyType

// TestHTTP_ToolReceivesVerifierContext proves the request-scoped context
// produced by the auth verifier is threaded all the way into the tool
// body (F-AUTH-1 / #132). The verifier stashes a sentinel on the
// context; the tool reads it back.
func TestHTTP_ToolReceivesVerifierContext(t *testing.T) {
	const sentinel = "profile-xyz"
	SetAuthVerifier(func(r *http.Request) (context.Context, error) {
		return context.WithValue(r.Context(), ctxSentinelKey, sentinel), nil
	})
	t.Cleanup(func() { SetAuthVerifier(nil) })

	var seen string
	tools := map[string]Tool{
		"whoami": func(ctx context.Context, _ jsontext.Value) (jsontext.Value, error) {
			if v, ok := ctx.Value(ctxSentinelKey).(string); ok {
				seen = v
			}
			return json.Marshal(struct {
				Profile string `json:"profile"`
			}{seen})
		},
	}
	srv := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { HandleHTTP(w, r, tools) })

	req := map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "whoami"}}
	b, _ := json.Marshal(req)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/mcp", bytes.NewReader(b))
	r.Header.Set("Authorization", "Bearer x")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("code %d body %q", w.Code, w.Body.String())
	}
	if seen != sentinel {
		t.Fatalf("tool body did not see verifier ctx value: got %q want %q", seen, sentinel)
	}
}

// TestSTDIO_ToolReceivesBackgroundContext: the stdio transport has no
// per-request enrichment hook, so the tool body must receive a non-nil
// context (context.Background()) rather than panicking.
func TestSTDIO_ToolReceivesBackgroundContext(t *testing.T) {
	var gotNonNil bool
	var leaked string
	tools := map[string]Tool{
		"check": func(ctx context.Context, _ jsontext.Value) (jsontext.Value, error) {
			gotNonNil = ctx != nil
			if v, ok := ctx.Value(ctxSentinelKey).(string); ok {
				leaked = v
			}
			return jsontext.Value("true"), nil
		},
	}
	in := bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check"}}` + "\n")
	var out bytes.Buffer
	if err := serveSTDIOWith(in, &out, tools); err != nil {
		t.Fatalf("serveSTDIOWith: %v", err)
	}
	if !gotNonNil {
		t.Fatal("stdio tool body got a nil context")
	}
	if leaked != "" {
		t.Fatalf("stdio tool body saw a leaked ctx value: %q", leaked)
	}
	if !strings.Contains(out.String(), `"result":true`) {
		t.Fatalf("unexpected stdio response: %q", out.String())
	}
}

// TestHTTP_VerifierError_NoDispatch: when the verifier returns an error,
// the request is rejected with 401 and the tool body never runs.
func TestHTTP_VerifierError_NoDispatch(t *testing.T) {
	SetAuthVerifier(func(*http.Request) (context.Context, error) {
		return nil, http.ErrAbortHandler // any error
	})
	t.Cleanup(func() { SetAuthVerifier(nil) })

	var ran bool
	tools := map[string]Tool{
		"echo": func(_ context.Context, p jsontext.Value) (jsontext.Value, error) {
			ran = true
			return p, nil
		},
	}
	srv := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { HandleHTTP(w, r, tools) })
	req := map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "echo", "params": map[string]any{"x": 1}}}
	b, _ := json.Marshal(req)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/mcp", bytes.NewReader(b))
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
	if ran {
		t.Fatal("tool body ran despite verifier error")
	}
}
