package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
	"geodedb.com/geode-ui/internal/conn"
)

// newOutcomeTestLimiter returns a limiter with a generous per-IP budget
// and a low lockout threshold so lockout behavior is observable within a
// few requests.
func newOutcomeTestLimiter(threshold int) *LoginLimiter {
	clk := newFakeClock()
	return NewLoginLimiter(LoginLimiterConfig{
		PerIPRate:     1000,
		PerIPBurst:    1000,
		FailThreshold: threshold,
		LockoutWindow: 15 * time.Minute,
		Now:           clk.Now,
	})
}

func postLogin(t *testing.T, h http.Handler, user string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login",
		strings.NewReader("username="+user+"&password=whatever-pw&profile=default"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.RemoteAddr = "1.2.3.4:54321"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// TestLoginLimiter_Wrapper_UpstreamFailureDoesNotLock pins the fix for
// engine outages locking real users out: a 401 that the login handler
// marked as a back-end failure (not a credential failure) must not
// count toward the per-user lockout, while the response the client sees
// stays the uniform 401.
func TestLoginLimiter_Wrapper_UpstreamFailureDoesNotLock(t *testing.T) {
	t.Parallel()
	l := newOutcomeTestLimiter(2)

	var calls atomic.Int32
	inner := http.NewServeMux()
	inner.HandleFunc("POST /api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		markLoginBackendFailure(r.Context())
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"code":"invalid_credentials"}`))
	})
	wrapped := WrapLoginLimit(l, inner)

	for i := range 10 {
		rec := postLogin(t, wrapped, "alice")
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("call[%d] code=%d want 401 (back-end failures must not lock)", i, rec.Code)
		}
	}
	if got := calls.Load(); got != 10 {
		t.Fatalf("inner called %d times want 10", got)
	}
}

// TestLoginLimiter_Wrapper_CredentialFailuresStillLockAfterOutage
// checks that back-end failures neither count nor reset the counter:
// genuine credential failures interleaved with outages still lock the
// account at the threshold.
func TestLoginLimiter_Wrapper_CredentialFailuresStillLockAfterOutage(t *testing.T) {
	t.Parallel()
	l := newOutcomeTestLimiter(2)

	var n atomic.Int32
	inner := http.NewServeMux()
	inner.HandleFunc("POST /api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		// Odd calls are outages, even calls are wrong passwords.
		if n.Add(1)%2 == 1 {
			markLoginBackendFailure(r.Context())
		}
		w.WriteHeader(http.StatusUnauthorized)
	})
	wrapped := WrapLoginLimit(l, inner)

	// outage, wrong pw, outage, wrong pw -> 2 credential failures.
	for i := range 4 {
		if rec := postLogin(t, wrapped, "bob"); rec.Code != http.StatusUnauthorized {
			t.Fatalf("call[%d] code=%d want 401", i, rec.Code)
		}
	}
	if rec := postLogin(t, wrapped, "bob"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("after 2 credential failures code=%d want 429", rec.Code)
	}
}

// TestMarkLoginBackendFailure_NoOutcomeInContext guards against a panic
// when the handler runs without the limiter wrapper (unit tests, or a
// deployment that mounts Login directly).
func TestMarkLoginBackendFailure_NoOutcomeInContext(t *testing.T) {
	t.Parallel()
	markLoginBackendFailure(context.Background())
}

// TestLogin_WithLimiter_OutageVsWrongPassword drives the real Login
// handler through the limiter: an upstream/transport error never locks
// the account and keeps the byte-identical 401, while wrong passwords
// still lock at the threshold.
func TestLogin_WithLimiter_OutageVsWrongPassword(t *testing.T) {
	prev := loginMinFailureLatency
	loginMinFailureLatency = 0
	t.Cleanup(func() { loginMinFailureLatency = prev })

	run := func(authErr error) (codes []int, bodies []string) {
		srv := New(Config{
			JWT:      newTestIssuer(t),
			Profiles: fakeProfileLookup{prof: conn.Profile{Name: "default", DSN: "stub://x"}},
			testAuthenticate: func(_ context.Context, _, _, _ string) (bool, []string, error) {
				return false, nil, authErr
			},
		})
		inner := http.NewServeMux()
		inner.HandleFunc("POST /api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
			_ = r.ParseForm()
			_, _ = srv.Login(w, r, &gentypes.LoginReq{
				Username: r.FormValue("username"),
				Password: r.FormValue("password"),
				Profile:  r.FormValue("profile"),
			})
		})
		wrapped := WrapLoginLimit(newOutcomeTestLimiter(3), inner)
		for range 6 {
			rec := postLogin(t, wrapped, "carol")
			codes = append(codes, rec.Code)
			bodies = append(bodies, rec.Body.String())
		}
		return codes, bodies
	}

	outCodes, outBodies := run(errors.New("dial udp: i/o timeout"))
	for i, c := range outCodes {
		if c != http.StatusUnauthorized {
			t.Fatalf("outage call[%d] code=%d want 401 (outages must not lock users out)", i, c)
		}
	}

	badCodes, badBodies := run(nil)
	for i := range 3 {
		if badCodes[i] != http.StatusUnauthorized {
			t.Fatalf("wrong-password call[%d] code=%d want 401", i, badCodes[i])
		}
	}
	if badCodes[3] != http.StatusTooManyRequests {
		t.Fatalf("wrong-password call[3] code=%d want 429 after 3 failures", badCodes[3])
	}

	// SEC-N10: the outage 401 and the wrong-password 401 are identical.
	if outBodies[0] != badBodies[0] {
		t.Fatalf("outage body %q != wrong-password body %q", outBodies[0], badBodies[0])
	}
}
