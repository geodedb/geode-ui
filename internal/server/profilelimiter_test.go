package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// TestProfileLimiter_AllowsBurstThenDenies pins the W1 acceptance
// criteria for GAP-S7 (#120):
//
//   - 30 successful CRUD requests in a window are all permitted (the
//     burst is sized to 30 for this test so the bucket starts full).
//   - The 31st request in the same window without time-advance is
//     rejected with 429 + Retry-After.
//   - After the bucket fully refills, the next request is permitted
//     again (window-reset behavior).
func TestProfileLimiter_AllowsBurstThenDenies(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	// Burst 30 with rate 0.5/s mirrors the production "30 req/min"
	// ceiling. We start the bucket full so 30 requests in a row
	// without time-advance must succeed.
	l := NewProfileLimiter(ProfileLimiterConfig{
		PerActorRate:  0.5,
		PerActorBurst: 30,
		Now:           clk.Now,
	})

	const key = "u\x00alice"
	for i := range 30 {
		ok, _ := l.Allow(key)
		if !ok {
			t.Fatalf("burst[%d] should be allowed (bucket starts full)", i)
		}
	}
	// 31st without time advance must be denied.
	ok, retry := l.Allow(key)
	if ok {
		t.Fatalf("31st request must be denied")
	}
	if retry <= 0 {
		t.Errorf("retry-after should be positive, got %v", retry)
	}

	// Advance enough for the bucket to fully refill (60 s @ 0.5/s = 30
	// tokens). The next request must be allowed again.
	clk.Add(60 * time.Second)
	if ok, _ := l.Allow(key); !ok {
		t.Errorf("after window refill, request must be allowed again")
	}
}

// TestProfileLimiter_PerActorIsolation verifies different actor keys
// hold independent buckets so one user cannot starve another.
func TestProfileLimiter_PerActorIsolation(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	l := NewProfileLimiter(ProfileLimiterConfig{
		PerActorRate:  0.5,
		PerActorBurst: 2,
		Now:           clk.Now,
	})
	// Drain alice's bucket.
	for i := range 2 {
		if ok, _ := l.Allow("u\x00alice"); !ok {
			t.Fatalf("alice burst[%d] should be allowed", i)
		}
	}
	if ok, _ := l.Allow("u\x00alice"); ok {
		t.Fatalf("alice should be drained after 2 reqs")
	}
	// Bob is untouched.
	if ok, _ := l.Allow("u\x00bob"); !ok {
		t.Errorf("bob bucket starved by alice's traffic")
	}
}

// TestProfileLimiter_Wrapper_PassesThroughGET verifies the wrapper
// only enforces on the four CRUD verbs. GET /api/v1/profiles and
// GET /api/v1/profiles/{id} pass straight through.
func TestProfileLimiter_Wrapper_PassesThroughGET(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	l := NewProfileLimiter(ProfileLimiterConfig{
		PerActorRate:  0.0001, // basically zero refill
		PerActorBurst: 1,
		Now:           clk.Now,
	})
	var calls int32
	inner := http.NewServeMux()
	inner.HandleFunc("GET /api/v1/profiles", func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusOK)
	})
	inner.HandleFunc("GET /api/v1/profiles/{id}", func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusOK)
	})
	inner.HandleFunc("GET /api/v1/profiles/public", func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusOK)
	})
	wrapped := WrapProfileLimit(l, inner)

	for i, p := range []string{"/api/v1/profiles", "/api/v1/profiles/abc", "/api/v1/profiles/public"} {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		req.RemoteAddr = "1.2.3.4:54321"
		rec := httptest.NewRecorder()
		wrapped.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s [%d]: status=%d, want 200 (read paths must not rate-limit)", p, i, rec.Code)
		}
	}
	if got := atomic.LoadInt32(&calls); got != 3 {
		t.Errorf("inner handler called %d times, want 3", got)
	}
}

// TestProfileLimiter_Wrapper_LimitsPostThirtyOne pins the end-to-end
// HTTP contract: the 31st POST /api/v1/profiles within the burst
// window from the same actor returns 429 with Retry-After, and the
// inner handler is short-circuited (not invoked).
func TestProfileLimiter_Wrapper_LimitsPostThirtyOne(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	l := NewProfileLimiter(ProfileLimiterConfig{
		PerActorRate:  0.5,
		PerActorBurst: 30,
		Now:           clk.Now,
	})
	var calls int32
	inner := http.NewServeMux()
	inner.HandleFunc("POST /api/v1/profiles", func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusOK)
	})
	wrapped := WrapProfileLimit(l, inner)

	// 30 POSTs from the same IP (no JWT issuer wired -> per-IP
	// fallback keying). All must be allowed.
	for i := range 30 {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles", strings.NewReader(`{}`))
		req.RemoteAddr = "1.2.3.4:54321"
		rec := httptest.NewRecorder()
		wrapped.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("POST[%d] code=%d, want 200", i, rec.Code)
		}
	}
	if got := atomic.LoadInt32(&calls); got != 30 {
		t.Fatalf("inner called %d times after 30 POSTs, want 30", got)
	}

	// 31st must be 429 + Retry-After, inner not called.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles", strings.NewReader(`{}`))
	req.RemoteAddr = "1.2.3.4:54321"
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("31st POST code=%d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Errorf("Retry-After header missing on 429")
	}
	if got := atomic.LoadInt32(&calls); got != 30 {
		t.Errorf("inner called %d times after 429, want 30 (handler must be short-circuited)", got)
	}

	// After window refill (60s @ 0.5/s = full bucket), the 32nd request
	// is allowed again.
	clk.Add(60 * time.Second)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/profiles", strings.NewReader(`{}`))
	req.RemoteAddr = "1.2.3.4:54321"
	rec = httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("after window refill, POST code=%d, want 200", rec.Code)
	}
}

// TestProfileLimiter_Wrapper_LimitsPatchAndDelete confirms the
// PATCH/DELETE /api/v1/profiles/{id} routes are also limited, not just
// the list-create POST.
func TestProfileLimiter_Wrapper_LimitsPatchAndDelete(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	l := NewProfileLimiter(ProfileLimiterConfig{
		PerActorRate:  0.0001,
		PerActorBurst: 1,
		Now:           clk.Now,
	})
	inner := http.NewServeMux()
	inner.HandleFunc("PATCH /api/v1/profiles/{id}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	inner.HandleFunc("DELETE /api/v1/profiles/{id}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	wrapped := WrapProfileLimit(l, inner)

	// First PATCH consumes the only token.
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/profiles/abc", strings.NewReader(`{}`))
	req.RemoteAddr = "1.2.3.4:1"
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("first PATCH code=%d, want 200", rec.Code)
	}
	// Second PATCH from same IP -> 429.
	req = httptest.NewRequest(http.MethodPatch, "/api/v1/profiles/xyz", strings.NewReader(`{}`))
	req.RemoteAddr = "1.2.3.4:1"
	rec = httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("second PATCH code=%d, want 429", rec.Code)
	}
	// DELETE shares the same per-actor bucket, so it is also denied.
	req = httptest.NewRequest(http.MethodDelete, "/api/v1/profiles/abc", nil)
	req.RemoteAddr = "1.2.3.4:1"
	rec = httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("DELETE after drain code=%d, want 429 (shared bucket)", rec.Code)
	}
}

// TestIsProfileCRUDPath spot-checks the path/method gate for the
// surfaces we care about.
func TestIsProfileCRUDPath(t *testing.T) {
	t.Parallel()
	cases := []struct {
		method string
		path   string
		want   bool
	}{
		{http.MethodPost, "/api/v1/profiles", true},
		{http.MethodPatch, "/api/v1/profiles/abc", true},
		{http.MethodDelete, "/api/v1/profiles/abc", true},
		{http.MethodGet, "/api/v1/profiles", false},
		{http.MethodGet, "/api/v1/profiles/abc", false},
		{http.MethodGet, "/api/v1/profiles/public", false},
		{http.MethodPost, "/api/v1/profiles/public", false},         // not a CRUD POST surface
		{http.MethodPatch, "/api/v1/profiles", false},               // PATCH on collection has no handler
		{http.MethodDelete, "/api/v1/profiles", false},              // DELETE on collection has no handler
		{http.MethodPost, "/api/v1/profiles/abc/sub", false},        // deeper nesting -> not us
		{http.MethodPost, "/api/v1/auth/login", false},              // login limiter handles this
		{http.MethodGet, "/api/v1/healthz", false},                  // not a profile route
		{http.MethodPatch, "/api/v1/profiles/", false},              // empty id segment
		{http.MethodPatch, "/api/v1/profiles/abc/something", false}, // sub-resource
	}
	for _, tc := range cases {
		got := isProfileCRUDPath(tc.method, tc.path)
		if got != tc.want {
			t.Errorf("isProfileCRUDPath(%q, %q) = %v, want %v", tc.method, tc.path, got, tc.want)
		}
	}
}

// TestProfileLimiter_AuditEmittedOn429 verifies the audit ring carries
// a profile_rate_limited event when the wrapper rejects a request --
// this is the operator-visible signal that someone is hammering the
// CRUD surface.
func TestProfileLimiter_AuditEmittedOn429(t *testing.T) {
	t.Cleanup(resetAuditRing())
	clk := newFakeClock()
	l := NewProfileLimiter(ProfileLimiterConfig{
		PerActorRate:  0.0001,
		PerActorBurst: 1,
		Now:           clk.Now,
	})
	inner := http.NewServeMux()
	inner.HandleFunc("POST /api/v1/profiles", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	wrapped := WrapProfileLimit(l, inner)

	// Drain: first POST allowed.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles", strings.NewReader(`{}`))
	req.RemoteAddr = "1.2.3.4:99"
	wrapped.ServeHTTP(httptest.NewRecorder(), req)
	// Second POST -> 429 -> audit event.
	req = httptest.NewRequest(http.MethodPost, "/api/v1/profiles", strings.NewReader(`{}`))
	req.RemoteAddr = "1.2.3.4:99"
	wrapped.ServeHTTP(httptest.NewRecorder(), req)

	saw := false
	for _, e := range defaultAuditRing.snapshot(time.Time{}) {
		if e.Event == "profile_rate_limited" {
			saw = true
			if e.Fields["method"] != http.MethodPost {
				t.Errorf("audit method=%v, want POST", e.Fields["method"])
			}
			if e.Fields["path"] != "/api/v1/profiles" {
				t.Errorf("audit path=%v, want /api/v1/profiles", e.Fields["path"])
			}
		}
	}
	if !saw {
		t.Errorf("profile_rate_limited audit event not emitted on 429")
	}
}
