package oidcx_test

import (
	"context"
	"encoding/json/v2"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"geodedb.com/geode-ui/gen/pkg/oidcx"
	"github.com/lestrrat-go/jwx/jwk"
)

// TestJWKCache_OnlyTreatsParsedJWKSetAsFresh is the regression test
// for APPSEC-13. The instrumentedHTTPClient previously bumped
// lastFreshAt on any HTTP 2xx response, including 200 OK with a
// malformed JWK Set body -- a "degraded but not down" IdP outage
// where the upstream returns success codes but corrupted payloads.
// Under that failure mode the cache silently bypassed
// WithMaxStaleness and kept serving the cold-start set indefinitely.
//
// After the fix, freshness is only stamped after the response body
// successfully parses as a non-empty JWK Set.
func TestJWKCache_OnlyTreatsParsedJWKSetAsFresh(t *testing.T) {
	t.Parallel()

	// Phase 1 of the server lifecycle returns a valid JWK set so
	// cold-start succeeds; phase 2 returns 200 OK with a malformed
	// body. The freshness stamp must NOT advance during phase 2.
	var phase atomic.Int32
	initial := jwk.NewSet()
	initial.Add(makeRSAKey(t, "kid-appsec13"))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/jwk-set+json")
		switch phase.Load() {
		case 0:
			// Cold-start: return the real set.
			buf, _ := jwkSetMarshal(initial)
			_, _ = w.Write(buf)
		default:
			// Degraded mode: HTTP 200 with malformed body.
			_, _ = w.Write([]byte(`{"keys":"not an array"}`))
		}
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Tunings:
	//   coldStart  → lastFreshAt at t≈0
	//   ageBeforeMalformed = 250ms (sleep before issuing malformed refresh)
	//   maxStaleness       = 350ms
	//   ageAfterMalformed  = 200ms (sleep after issuing malformed refresh)
	//
	// Pre-fix: malformed refresh bumps lastFreshAt to t≈250ms, the
	//          assertion at t≈450ms sees age=200ms < 350ms → Healthy.
	// Post-fix: malformed refresh is ignored, lastFreshAt stays at 0,
	//          assertion at t≈450ms sees age=450ms > 350ms → unhealthy.
	cache, err := oidcx.NewJWKCache(ctx, srv.URL+"/jwks.json",
		oidcx.WithMinRefreshInterval(50*time.Millisecond),
		oidcx.WithMaxStaleness(350*time.Millisecond),
	)
	if err != nil {
		t.Fatalf("NewJWKCache: %v", err)
	}

	// Cold-start succeeded → cache is healthy.
	if !cache.Healthy() {
		t.Fatal("cache should be Healthy() after cold-start")
	}

	// Hold steady for a window so a subsequent freshness bump is
	// distinguishable from the cold-start one.
	time.Sleep(250 * time.Millisecond)

	// Flip to degraded mode and refresh. The response is HTTP 200 +
	// garbage; pre-fix the freshness stamp gets bumped to "now"
	// despite the malformed body, post-fix it stays at the cold-start
	// timestamp.
	phase.Store(1)
	_, _ = cache.Refresh(ctx)

	// Wait long enough that age-since-cold-start > MaxStaleness but
	// age-since-malformed-refresh would still be < MaxStaleness.
	time.Sleep(200 * time.Millisecond)

	if cache.Healthy() {
		t.Error("cache.Healthy() should be false; malformed 200 must NOT advance the freshness stamp")
	}
	if _, err := cache.Set(ctx); !errors.Is(err, oidcx.ErrJWKSStaleExceeded) {
		t.Errorf("Set err = %v, want %v", err, oidcx.ErrJWKSStaleExceeded)
	}
}

// jwkSetMarshal serializes the JWK set with json/v2, matching the
// rest of the package's test files.
func jwkSetMarshal(s jwk.Set) ([]byte, error) { return json.Marshal(s) }
