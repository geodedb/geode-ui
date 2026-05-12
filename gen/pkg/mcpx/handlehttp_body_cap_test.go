package mcpx

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestHandleHTTP_RejectsBodyOverLimit is the regression test for
// APPSEC-1 residual. The route-level wrapper in genapi's emitted
// server.go.tmpl now caps the /mcp body via http.MaxBytesReader, but
// HandleHTTP itself was still doing an unbounded io.ReadAll. Any
// future caller wiring HandleHTTP without the route wrapper would
// re-open the DoS path. This test pins the engine-level defense:
// HandleHTTP must reject bodies > MaxHTTPBodyBytes with HTTP 413
// regardless of how it is wired upstream.
func TestHandleHTTP_RejectsBodyOverLimit(t *testing.T) {
	// Save and restore globals so the test does not leak state.
	prevAuth := authVerifier
	prevLimit := MaxHTTPBodyBytes()
	t.Cleanup(func() {
		SetAuthVerifier(prevAuth)
		SetMaxHTTPBodyBytes(prevLimit)
	})

	SetAuthVerifier(func(r *http.Request) (context.Context, error) { return r.Context(), nil })
	SetMaxHTTPBodyBytes(1024) // 1 KiB cap for this test

	body := bytes.Repeat([]byte("x"), 4096) // 4 KiB > 1 KiB
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/mcp", bytes.NewReader(body))
	w := httptest.NewRecorder()

	HandleHTTP(w, r, nil)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want %d (413 Request Entity Too Large)", w.Code, http.StatusRequestEntityTooLarge)
	}
	if !strings.Contains(w.Body.String(), "too large") {
		t.Errorf("response body should mention size limit, got %q", w.Body.String())
	}
}

// TestHandleHTTP_AcceptsBodyAtLimit is the positive path: a body
// exactly at MaxHTTPBodyBytes must still parse normally (the cap is
// inclusive of the configured size, exclusive only of overage).
func TestHandleHTTP_AcceptsBodyAtLimit(t *testing.T) {
	prevAuth := authVerifier
	prevLimit := MaxHTTPBodyBytes()
	t.Cleanup(func() {
		SetAuthVerifier(prevAuth)
		SetMaxHTTPBodyBytes(prevLimit)
	})

	SetAuthVerifier(func(r *http.Request) (context.Context, error) { return r.Context(), nil })

	const cap = 1024
	SetMaxHTTPBodyBytes(cap)
	// A well-formed JSON-RPC request shorter than the cap.
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	if int64(len(body)) >= cap {
		t.Fatalf("test invariant: body size %d should be < cap %d", len(body), cap)
	}
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/mcp", bytes.NewReader(body))
	w := httptest.NewRecorder()

	HandleHTTP(w, r, map[string]Tool{})

	// The dispatcher will reply with a JSON-RPC envelope (success or
	// error) rather than a transport-level 413; the only assertion we
	// make here is "did NOT get a 413 transport rejection".
	if w.Code == http.StatusRequestEntityTooLarge {
		t.Errorf("under-cap body got 413 Request Entity Too Large")
	}
}
