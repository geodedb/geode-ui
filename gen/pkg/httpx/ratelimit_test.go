package httpx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// nopHandler returns a handler that always writes 200.
var nopHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
})

// TestRouteLimiter_AllowsBurst verifies that RouteLimiter allows requests up
// to the burst size without throttling.
func TestRouteLimiter_AllowsBurst(t *testing.T) {
	const burst = 5
	h := RouteLimiter(10, burst, nopHandler)

	for i := range burst {
		r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i+1, w.Code)
		}
	}
}

// TestRouteLimiter_ThrottlesAfterBurst verifies that RouteLimiter rejects
// requests once the token bucket is exhausted.
func TestRouteLimiter_ThrottlesAfterBurst(t *testing.T) {
	// rate=0 means no refill; burst=2 means exactly two tokens available.
	h := RouteLimiter(0, 2, nopHandler)

	ok, throttled := 0, 0
	for range 5 {
		r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		switch w.Code {
		case http.StatusOK:
			ok++
		case http.StatusTooManyRequests:
			throttled++
		default:
			t.Fatalf("unexpected status %d", w.Code)
		}
	}
	if ok != 2 {
		t.Fatalf("expected exactly 2 allowed, got %d", ok)
	}
	if throttled != 3 {
		t.Fatalf("expected exactly 3 throttled, got %d", throttled)
	}
}

// TestRouteLimiter_RateLimitHeaders verifies that X-RateLimit-* headers are
// set on every response.
func TestRouteLimiter_RateLimitHeaders(t *testing.T) {
	h := RouteLimiter(10, 10, nopHandler)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	for _, hdr := range []string{"X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"} {
		if w.Header().Get(hdr) == "" {
			t.Fatalf("missing header %q", hdr)
		}
	}
}

// TestRouteLimiter_ConcurrentSafe ensures RouteLimiter does not race under
// concurrent access. Run with -race to catch data races.
func TestRouteLimiter_ConcurrentSafe(t *testing.T) {
	h := RouteLimiter(1000, 1000, nopHandler)
	var wg sync.WaitGroup
	for range 50 {
		wg.Go(func() {
			r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
		})
	}
	wg.Wait()
}

// TestBodyLimiter_BlocksOversizedBody verifies that limitBody rejects requests
// whose Content-Length exceeds the cap.
func TestBodyLimiter_BlocksOversizedBody(t *testing.T) {
	const cap = 10
	h := limitBody(cap, nopHandler)

	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", nil)
	r.ContentLength = cap + 1
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", w.Code)
	}
}

// TestBodyLimiter_AllowsNormalBody verifies that limitBody passes through
// requests under the size cap.
func TestBodyLimiter_AllowsNormalBody(t *testing.T) {
	const cap = 100
	h := limitBody(cap, nopHandler)

	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", nil)
	r.ContentLength = cap - 1
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}
