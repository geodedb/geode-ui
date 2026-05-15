package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	genapi "geodedb.com/geode-ui/gen/api"
)

// TestGlobalRate_CrossRouteAggregateCeiling proves that geode-ui's
// genapi.APIOptions.GlobalRate is now a real server-wide aggregate token
// bucket shared across every generated route (landed via genapi commit
// 2eabc11, recommended tag v0.3.1).
//
// With a low budget (rate 2 rps, burst 1) the first authenticated request to
// route A (GET /api/v1/capabilities) consumes the only burst token; a
// follow-up authenticated request to a *different* route B (GET
// /api/v1/graphs) is then rejected with 429 by the aggregate limiter --
// before its handler runs -- which is what makes this a cross-route ceiling,
// not a per-route one. Both routes only require `auth: "jwt"` (no
// required_roles), so a stub AuthJWT verifier that returns nil is sufficient
// to reach the rate-limit stage.
func TestGlobalRate_CrossRouteAggregateCeiling(t *testing.T) {
	srv, _ := newTestServerWithStore(t)

	stubAuthJWT := func(_ *http.Request) error { return nil }

	mux := http.NewServeMux()
	genapi.RegisterGeneratedAPI(mux, srv, genapi.APIOptions{
		AuthJWT:     stubAuthJWT,
		GlobalRate:  2,
		GlobalBurst: 1,
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	get := func(path string) (*http.Response, []byte) {
		t.Helper()
		req, err := http.NewRequest(http.MethodGet, ts.URL+path, nil)
		if err != nil {
			t.Fatalf("new request %s: %v", path, err)
		}
		req.Header.Set("Authorization", "Bearer test-token")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		return resp, body
	}

	// Route A: consumes the single shared burst token.
	respA, bodyA := get("/api/v1/capabilities")
	if respA.StatusCode != http.StatusOK {
		t.Fatalf("route A GET /api/v1/capabilities: want 200, got %d (body %q)", respA.StatusCode, string(bodyA))
	}

	// Route B: a *different* endpoint. The aggregate budget is now exhausted,
	// so the shared globalRateBkt rejects this request with 429 before the
	// Graphs handler (which would otherwise touch the pool) ever runs.
	respB, bodyB := get("/api/v1/graphs")
	if respB.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("route B GET /api/v1/graphs: want 429 from the cross-route aggregate limiter, got %d (body %q)", respB.StatusCode, string(bodyB))
	}
	if respB.Header.Get("X-RateLimit-Limit") == "" {
		t.Errorf("route B 429 response is missing X-RateLimit-Limit header")
	}
	if !strings.Contains(string(bodyB), "rate limit") {
		t.Errorf("route B 429 body = %q; want a rate-limit error envelope", string(bodyB))
	}
}

// TestGlobalRate_DisabledWhenZero confirms the aggregate limiter is inert when
// GlobalRate is 0 (the "global_rps: 0 disables it" contract): many requests
// across two routes all avoid a 429 from the aggregate ceiling.
func TestGlobalRate_DisabledWhenZero(t *testing.T) {
	srv, _ := newTestServerWithStore(t)
	stubAuthJWT := func(_ *http.Request) error { return nil }

	mux := http.NewServeMux()
	genapi.RegisterGeneratedAPI(mux, srv, genapi.APIOptions{
		AuthJWT:     stubAuthJWT,
		GlobalRate:  0,
		GlobalBurst: 0,
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	for i := 0; i < 25; i++ {
		path := "/api/v1/capabilities"
		if i%2 == 1 {
			path = "/api/v1/graphs"
		}
		req, _ := http.NewRequest(http.MethodGet, ts.URL+path, nil)
		req.Header.Set("Authorization", "Bearer test-token")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request %d GET %s: %v", i, path, err)
		}
		_, _ = io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests {
			t.Fatalf("request %d GET %s returned 429 but the aggregate limiter should be disabled (GlobalRate=0)", i, path)
		}
	}
}
