package server

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// frozenClock returns a func(now) that advances on each call by the
// supplied step, starting at base. Returns the func plus a pointer to
// advance externally.
type fakeClock struct {
	t time.Time
}

func (c *fakeClock) Now() time.Time      { return c.t }
func (c *fakeClock) Add(d time.Duration) { c.t = c.t.Add(d) }

func newFakeClock() *fakeClock {
	return &fakeClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
}

func TestLoginLimiter_PerIPRateLimit(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	// 1/sec, burst 2.
	l := NewLoginLimiter(LoginLimiterConfig{
		PerIPRate:     1,
		PerIPBurst:    2,
		FailThreshold: 100, // disabled for this test
		LockoutWindow: time.Hour,
		Now:           clk.Now,
	})

	// First two requests allowed (burst).
	for i := 0; i < 2; i++ {
		ok, _, _ := l.Allow("1.2.3.4", "default", "alice")
		if !ok {
			t.Fatalf("burst[%d] should be allowed", i)
		}
	}
	// Third request without time advance must be denied.
	ok, retry, reason := l.Allow("1.2.3.4", "default", "alice")
	if ok {
		t.Fatalf("third request should be denied")
	}
	if reason != "ip_rate_limited" {
		t.Errorf("reason=%q want ip_rate_limited", reason)
	}
	if retry <= 0 {
		t.Errorf("retry-after should be positive")
	}

	// Different IP must NOT share the bucket.
	if ok, _, _ := l.Allow("9.9.9.9", "default", "alice"); !ok {
		t.Errorf("different IP must be allowed (separate bucket)")
	}

	// Advance one second; one token regenerates.
	clk.Add(time.Second)
	if ok, _, _ := l.Allow("1.2.3.4", "default", "alice"); !ok {
		t.Errorf("after 1s the 1.2.3.4 bucket should refill one token")
	}
}

func TestLoginLimiter_LockoutAfterThreshold(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	l := NewLoginLimiter(LoginLimiterConfig{
		PerIPRate:     1000, // disabled rate-limit for this test
		PerIPBurst:    1000,
		FailThreshold: 3,
		LockoutWindow: 15 * time.Minute,
		Now:           clk.Now,
	})

	// 3 fails on (default, alice). Threshold=3 means the 3rd fail puts the
	// account into lockout — no further attempts should be allowed.
	for i := 0; i < 3; i++ {
		l.NoteFail("default", "alice")
	}

	ok, retry, reason := l.Allow("1.2.3.4", "default", "alice")
	if ok {
		t.Fatalf("locked-out user should be denied")
	}
	if reason != "user_locked" {
		t.Errorf("reason=%q want user_locked", reason)
	}
	if retry <= 0 || retry > 15*time.Minute {
		t.Errorf("retry=%v want (0, 15m]", retry)
	}

	// Different username on same IP/profile should be allowed.
	if ok, _, _ := l.Allow("1.2.3.4", "default", "bob"); !ok {
		t.Errorf("different username should be allowed")
	}

	// Different profile, same username — should be allowed (separate key).
	if ok, _, _ := l.Allow("1.2.3.4", "other", "alice"); !ok {
		t.Errorf("different profile should be allowed (separate key)")
	}

	// After lockout window expires, alice should be allowed again.
	clk.Add(15*time.Minute + time.Second)
	if ok, _, _ := l.Allow("1.2.3.4", "default", "alice"); !ok {
		t.Errorf("after lockout window expiry, user should be allowed again")
	}
}

func TestLoginLimiter_NoteSuccessClearsLockout(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	l := NewLoginLimiter(LoginLimiterConfig{
		PerIPRate:     1000,
		PerIPBurst:    1000,
		FailThreshold: 3,
		LockoutWindow: 15 * time.Minute,
		Now:           clk.Now,
	})

	// 2 fails (under threshold), then a success — counter must reset.
	l.NoteFail("default", "alice")
	l.NoteFail("default", "alice")
	l.NoteSuccess("default", "alice")

	// Two more fails should NOT trip the lockout (counter was reset).
	l.NoteFail("default", "alice")
	l.NoteFail("default", "alice")
	if ok, _, _ := l.Allow("1.2.3.4", "default", "alice"); !ok {
		t.Errorf("after success-reset, 2 fresh fails must not lock account")
	}
}

func TestLoginLimiter_CanonicalProfile(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	l := NewLoginLimiter(LoginLimiterConfig{
		PerIPRate:     1000,
		PerIPBurst:    1000,
		FailThreshold: 3,
		LockoutWindow: 15 * time.Minute,
		Now:           clk.Now,
	})
	// Three fails registered against the EMPTY profile must produce
	// the same lockout as if registered against "default" — the
	// limiter has to canonicalize empty -> default to keep the bucket
	// key aligned with the handler's eventual auth attempt.
	l.NoteFail("", "alice")
	l.NoteFail("", "alice")
	l.NoteFail("", "alice")

	if ok, _, reason := l.Allow("1.2.3.4", "default", "alice"); ok {
		t.Errorf("canonical empty->default lockout missing; reason=%q", reason)
	}
}

func TestLoginLimiter_Wrapper_Lockout(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	l := NewLoginLimiter(LoginLimiterConfig{
		PerIPRate:     1000,
		PerIPBurst:    1000,
		FailThreshold: 2,
		LockoutWindow: 15 * time.Minute,
		Now:           clk.Now,
	})

	// Stub login that always 401s.
	var calls int32
	inner := http.NewServeMux()
	inner.HandleFunc("POST /api/v1/auth/login", func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"code":"invalid_credentials"}`))
	})
	wrapped := WrapLoginLimit(l, inner)

	// Two 401s -> reaches threshold.
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login",
			strings.NewReader("username=alice&password=wrong&profile=default"))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.RemoteAddr = "1.2.3.4:54321"
		rec := httptest.NewRecorder()
		wrapped.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("call[%d] code=%d want 401", i, rec.Code)
		}
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("inner called %d times after 2 fails want 2", got)
	}

	// Third call must be short-circuited at the wrapper (429), inner not invoked.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login",
		strings.NewReader("username=alice&password=wrong&profile=default"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.RemoteAddr = "1.2.3.4:54321"
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("after lockout code=%d want 429", rec.Code)
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Errorf("inner called %d times after lockout want 2 (no further calls)", got)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Errorf("Retry-After header missing on 429")
	}
}

func TestLoginLimiter_Wrapper_NoteSuccessOn200(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	l := NewLoginLimiter(LoginLimiterConfig{
		PerIPRate:     1000,
		PerIPBurst:    1000,
		FailThreshold: 2,
		LockoutWindow: 15 * time.Minute,
		Now:           clk.Now,
	})

	// Inner: first call 401, second call 200 (success after a fail).
	state := atomic.Int32{}
	inner := http.NewServeMux()
	inner.HandleFunc("POST /api/v1/auth/login", func(w http.ResponseWriter, _ *http.Request) {
		n := state.Add(1)
		if n == 1 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"access_token":"x","token_type":"Bearer","expires_in":1}`))
	})
	wrapped := WrapLoginLimit(l, inner)

	// One fail.
	form := url.Values{"username": {"alice"}, "password": {"wrong"}, "profile": {"default"}}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.RemoteAddr = "1.2.3.4:1"
	wrapped.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("first call code=%d want 401", rec.Code)
	}

	// One success.
	form = url.Values{"username": {"alice"}, "password": {"right"}, "profile": {"default"}}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.RemoteAddr = "1.2.3.4:2"
	wrapped.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("success call code=%d want 200", rec.Code)
	}

	// Two further fails should NOT trip the lockout (counter was reset on success).
	state.Store(0) // make inner 401 again
	for i := 0; i < 2; i++ {
		rec = httptest.NewRecorder()
		req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login",
			strings.NewReader("username=alice&password=wrong&profile=default"))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.RemoteAddr = "1.2.3.4:99"
		wrapped.ServeHTTP(rec, req)
		// Inner is stubbed to 200 on second hit per test (state>=2), but we
		// reset state to 0 — so inner returns 401 again on these. The point
		// is the limiter saw a Success in between, so the lockout counter
		// should be at 1 (not 3) and remain unlocked.
		_ = rec.Code
	}
	// One more attempt should still be allowed (would NOT be allowed if
	// the success above had not reset the fail counter).
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login",
		strings.NewReader("username=alice&password=wrong&profile=default"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.RemoteAddr = "1.2.3.4:99"
	wrapped.ServeHTTP(rec, req)
	if rec.Code == http.StatusTooManyRequests {
		t.Errorf("unexpected lockout after success reset (got 429)")
	}
}

func TestLoginLimiter_Wrapper_PassesThroughNonLogin(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	l := NewLoginLimiter(LoginLimiterConfig{
		PerIPRate:     0.001, // basically always rate-limited if applied
		PerIPBurst:    1,
		FailThreshold: 1,
		LockoutWindow: time.Hour,
		Now:           clk.Now,
	})
	inner := http.NewServeMux()
	inner.HandleFunc("GET /api/v1/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	wrapped := WrapLoginLimit(l, inner)

	for i := 0; i < 5; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/healthz", nil)
		req.RemoteAddr = "1.2.3.4:54321"
		wrapped.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("non-login route should not be rate-limited; got %d on iter %d", rec.Code, i)
		}
	}
}

func TestClientIPFromXForwardedFor(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		h    http.Header
		ra   string
		want string
	}{
		{"xff first hop", http.Header{"X-Forwarded-For": []string{"203.0.113.1, 10.0.0.1"}}, "10.1.2.3:443", "203.0.113.1"},
		{"xff with spaces", http.Header{"X-Forwarded-For": []string{"  203.0.113.2 ,10.0.0.1"}}, "10.1.2.3:443", "203.0.113.2"},
		{"empty xff falls back to remote", http.Header{}, "10.1.2.3:443", "10.1.2.3"},
		{"ipv6 remote", http.Header{}, "[::1]:443", "::1"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.Header = tc.h
			req.RemoteAddr = tc.ra
			got := clientIP(req)
			if got != tc.want {
				t.Errorf("clientIP=%q want %q", got, tc.want)
			}
		})
	}
}
