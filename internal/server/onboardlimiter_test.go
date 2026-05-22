package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// TestOnboardLimiter_BurstThenReject pins the per-IP token bucket on
// POST /api/v1/profiles/onboard. The burst size's worth of requests
// must succeed; the next request must come back as 429 with a
// Retry-After header AND emit a profile_onboard_failure audit row
// carrying reason=rate_limited.
//
// The test wires the real WrapOnboardLimit middleware around a
// HandleOnboard backed by an in-memory store + a short-circuited probe
// override so the request flow is identical to production except for
// the upstream-credential check (which we cannot reach across a test
// boundary). A fixed-clock Now function freezes time so the bucket
// cannot refill between request N and request N+1 (5 sequential
// requests would otherwise be allowed by the default 1rps + 5 burst
// configuration via wall-clock drift).
func TestOnboardLimiter_BurstThenReject(t *testing.T) {
	frozen := time.Date(2026, 5, 21, 12, 0, 0, 0, time.UTC)
	limiter := NewOnboardLimiter(OnboardLimiterConfig{
		PerIPRate:     1,
		PerIPBurst:    3,
		Now:           func() time.Time { return frozen },
		MaxIdle:       time.Hour,
		PruneInterval: 0, // janitor off; test drives Allow() synchronously
		MaxEntries:    100,
	})

	iss := newTestIssuer(t)
	store := newFakeProfileStore()
	srv := New(Config{
		JWT:                     iss,
		Store:                   store,
		testAuthenticateOnboard: fakeOnboardProbe("alice", "pw"),
	})
	handler := WrapOnboardLimit(limiter, http.HandlerFunc(srv.HandleOnboard))

	mkRequest := func(name string) *http.Request {
		body, _ := json.Marshal(map[string]string{
			"name":           name,
			"dsn":            "quic://prod.example.com:3141",
			"admin_username": "alice",
			"admin_password": "pw", // pragma: allowlist secret
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles/onboard", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		// httptest.NewRequest sets RemoteAddr to "192.0.2.1:1234"; pin it
		// to a known value so clientIP() returns the same key for every
		// call (so all 4 requests bucket together).
		req.RemoteAddr = "203.0.113.42:55555"
		return req
	}

	// First PerIPBurst (3) requests must succeed. Each uses a fresh
	// profile name so the store doesn't 409-collide.
	for i := 0; i < 3; i++ {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, mkRequest("prod-"+strconv.Itoa(i)))
		if rec.Code != http.StatusOK {
			t.Fatalf("burst request %d: status=%d want 200 body=%s", i, rec.Code, rec.Body.String())
		}
	}

	// The next request — same IP, no clock advance — must trip the
	// limiter.
	t0 := time.Now()
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, mkRequest("prod-overflow"))
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("overflow request: status=%d want 429 body=%s", rec.Code, rec.Body.String())
	}
	if ra := rec.Header().Get("Retry-After"); ra == "" {
		t.Errorf("Retry-After header missing on 429")
	} else if secs, err := strconv.Atoi(ra); err != nil || secs < 1 {
		t.Errorf("Retry-After=%q not a positive integer", ra)
	}
	if !strings.Contains(rec.Body.String(), ErrCodeRateLimited) {
		t.Errorf("body=%s should carry code=%q", rec.Body.String(), ErrCodeRateLimited)
	}

	// The 429 must leave a profile_onboard_failure audit row with
	// reason=rate_limited so an abuse trace is reconstructible.
	entries := defaultAuditRing.snapshot(t0)
	var found *AuditEntry
	for i := range entries {
		if entries[i].Event != auditEventOnboardFailure {
			continue
		}
		if r, _ := entries[i].Fields["reason"].(string); r == "rate_limited" {
			found = &entries[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("no %s audit entry with reason=rate_limited; got %d entries since t0",
			auditEventOnboardFailure, len(entries))
	}
	if ip, _ := found.Fields["ip"].(string); ip != "203.0.113.42" {
		t.Errorf("audit ip=%v want 203.0.113.42", found.Fields["ip"])
	}

	// The pre-trip Store.Put count must still be exactly PerIPBurst (the
	// 429'd request must NOT have run HandleOnboard's body, so no
	// upstream probe / no store write).
	if len(store.puts) != 3 {
		t.Errorf("store.puts=%d want 3 (one per allowed burst request)", len(store.puts))
	}
}

// TestOnboardLimiter_RefillAllowsAnother pins the refill side: after
// enough simulated wall-clock advance to mint one fresh token, the
// next request must succeed again. Anchors that the limiter is a
// bucket, not a hard counter.
func TestOnboardLimiter_RefillAllowsAnother(t *testing.T) {
	frozen := time.Date(2026, 5, 21, 12, 0, 0, 0, time.UTC)
	now := frozen
	limiter := NewOnboardLimiter(OnboardLimiterConfig{
		PerIPRate:  1, // 1 rps -> 1s per token
		PerIPBurst: 1,
		Now:        func() time.Time { return now },
	})

	// Burn the single burst token.
	ok, _ := limiter.Allow("198.51.100.7")
	if !ok {
		t.Fatalf("first Allow should succeed (burst=1)")
	}
	// Same instant: must reject.
	ok, retry := limiter.Allow("198.51.100.7")
	if ok {
		t.Fatalf("second Allow at same instant should reject")
	}
	if retry < time.Second {
		t.Errorf("Retry-After=%v want >= 1s", retry)
	}
	// Advance the clock past one full refill window.
	now = now.Add(2 * time.Second)
	ok, _ = limiter.Allow("198.51.100.7")
	if !ok {
		t.Fatalf("Allow after 2s should succeed (1 token refilled)")
	}
}

// TestOnboardLimiter_NonMatchingPathPassesThrough confirms the
// path/method gate: a GET (or a POST to a different path) must NOT
// consume a bucket token. Anchors the wrapper's no-overhead-for-other-
// traffic invariant.
func TestOnboardLimiter_NonMatchingPathPassesThrough(t *testing.T) {
	limiter := NewOnboardLimiter(OnboardLimiterConfig{
		PerIPRate:  1,
		PerIPBurst: 1,
	})
	passes := 0
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		passes++
		w.WriteHeader(http.StatusNoContent)
	})
	handler := WrapOnboardLimit(limiter, inner)

	// 10 GET /healthz requests from the same IP — none should be
	// limited.
	for i := 0; i < 10; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		req.RemoteAddr = "192.0.2.99:1234"
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("GET %d: status=%d want 204", i, rec.Code)
		}
	}
	if passes != 10 {
		t.Errorf("inner handler ran %d times, want 10", passes)
	}
	if limiter.PerIPCount() != 0 {
		t.Errorf("limiter perIP map has %d entries; non-matching traffic should not touch the bucket map", limiter.PerIPCount())
	}
}
