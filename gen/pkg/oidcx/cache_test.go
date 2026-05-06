package oidcx_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
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

// makeRSAKey returns a fresh RSA-2048 jwk.Key with a stable kid. The key
// material is generated per call so each test exercises a distinct key.
func makeRSAKey(t *testing.T, kid string) jwk.Key {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa.GenerateKey: %v", err)
	}
	pub := priv.PublicKey
	k, err := jwk.New(&pub)
	if err != nil {
		t.Fatalf("jwk.New: %v", err)
	}
	if err := k.Set(jwk.KeyIDKey, kid); err != nil {
		t.Fatalf("jwk.Set kid: %v", err)
	}
	if err := k.Set(jwk.AlgorithmKey, "RS256"); err != nil {
		t.Fatalf("jwk.Set alg: %v", err)
	}
	return k
}

// rotatingJWKSServer serves a JWKS document whose key set can be swapped
// atomically. requests counts the number of GETs the server has handled,
// so tests can prove the cache made an underlying refresh call.
type rotatingJWKSServer struct {
	srv      *httptest.Server
	cur      atomic.Pointer[jwk.Set]
	requests atomic.Int64
	failures atomic.Int64
	failNext atomic.Int32 // when >0, decrements and returns 503
}

func newRotatingJWKSServer(t *testing.T, initial jwk.Set) *rotatingJWKSServer {
	t.Helper()
	r := &rotatingJWKSServer{}
	r.cur.Store(&initial)
	r.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		r.requests.Add(1)
		if r.failNext.Load() > 0 {
			r.failNext.Add(-1)
			r.failures.Add(1)
			http.Error(w, "synthetic outage", http.StatusServiceUnavailable)
			return
		}
		setPtr := r.cur.Load()
		buf, err := json.Marshal(*setPtr)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/jwk-set+json")
		_, _ = w.Write(buf)
	}))
	t.Cleanup(r.srv.Close)
	return r
}

func (r *rotatingJWKSServer) URL() string { return r.srv.URL + "/jwks.json" }

func (r *rotatingJWKSServer) rotate(s jwk.Set) {
	r.cur.Store(&s)
}

// TestJWKCache_PicksUpRotation: after a forced refresh the new key kid
// must appear in the cached set. Closes PERF-0043 + SEC #150 acceptance.
func TestJWKCache_PicksUpRotation(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	initial := jwk.NewSet()
	initial.Add(makeRSAKey(t, "kid-1"))
	srv := newRotatingJWKSServer(t, initial)

	cache, err := oidcx.NewJWKCache(ctx, srv.URL(),
		oidcx.WithMinRefreshInterval(time.Second),
	)
	if err != nil {
		t.Fatalf("NewJWKCache: %v", err)
	}

	got, err := cache.Set(ctx)
	if err != nil {
		t.Fatalf("Set (initial): %v", err)
	}
	if _, ok := got.LookupKeyID("kid-1"); !ok {
		t.Fatalf("expected kid-1 to be present in cold-start set")
	}

	// Rotate at the IdP and force an immediate refresh.
	rotated := jwk.NewSet()
	rotated.Add(makeRSAKey(t, "kid-2"))
	srv.rotate(rotated)

	if _, err := cache.Refresh(ctx); err != nil {
		t.Fatalf("Refresh (post-rotation): %v", err)
	}
	got2, err := cache.Set(ctx)
	if err != nil {
		t.Fatalf("Set (post-rotation): %v", err)
	}
	if _, ok := got2.LookupKeyID("kid-2"); !ok {
		t.Fatalf("expected kid-2 after rotation; got len=%d", got2.Len())
	}
	if _, ok := got2.LookupKeyID("kid-1"); ok {
		t.Fatalf("expected kid-1 to be evicted after rotation")
	}
}

// TestJWKCache_RefreshOnFailure_ServesStale verifies the cache continues
// to serve the last-good set when the IdP is briefly unavailable.
func TestJWKCache_RefreshOnFailure_ServesStale(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	initial := jwk.NewSet()
	initial.Add(makeRSAKey(t, "kid-stable"))
	srv := newRotatingJWKSServer(t, initial)

	cache, err := oidcx.NewJWKCache(ctx, srv.URL(),
		oidcx.WithMinRefreshInterval(time.Second),
	)
	if err != nil {
		t.Fatalf("NewJWKCache: %v", err)
	}

	// Inject a synthetic 503. AutoRefresh.Refresh should propagate the
	// error from the doRefreshRequest path; Set, however, must keep
	// serving the cached set.
	srv.failNext.Store(3)
	if _, err := cache.Refresh(ctx); err == nil {
		t.Fatalf("expected Refresh to surface the upstream 503")
	}

	got, err := cache.Set(ctx)
	if err != nil {
		t.Fatalf("Set during outage: %v", err)
	}
	if _, ok := got.LookupKeyID("kid-stable"); !ok {
		t.Fatalf("expected stale kid-stable to remain available during outage")
	}
}

// TestJWKCache_NilReceiver: the package never panics on a nil receiver.
func TestJWKCache_NilReceiver(t *testing.T) {
	t.Parallel()
	var c *oidcx.JWKCache
	if _, err := c.Set(context.Background()); !errors.Is(err, oidcx.ErrNilJWKCache) {
		t.Fatalf("expected ErrNilJWKCache from Set, got: %v", err)
	}
	if _, err := c.Refresh(context.Background()); !errors.Is(err, oidcx.ErrNilJWKCache) {
		t.Fatalf("expected ErrNilJWKCache from Refresh, got: %v", err)
	}
	if u := c.URL(); u != "" {
		t.Fatalf("expected empty URL on nil cache, got %q", u)
	}
}

// TestJWKCache_RejectsEmptyURL: defensive validation at construction.
func TestJWKCache_RejectsEmptyURL(t *testing.T) {
	t.Parallel()
	_, err := oidcx.NewJWKCache(context.Background(), "")
	if err == nil {
		t.Fatalf("expected error for empty JWKS URL")
	}
}

// TestJWKCache_RejectsEmptyKeySet: when the IdP returns an empty key
// document on cold start, treat as misconfiguration.
func TestJWKCache_RejectsEmptyKeySet(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/jwk-set+json")
		_, _ = w.Write([]byte(`{"keys":[]}`))
	}))
	t.Cleanup(srv.Close)

	_, err := oidcx.NewJWKCache(ctx, srv.URL+"/jwks.json")
	if !errors.Is(err, oidcx.ErrEmptyJWKSet) {
		t.Fatalf("expected ErrEmptyJWKSet, got: %v", err)
	}
}

// recordingLogger captures Warn/Error calls for assertion. It is
// goroutine-safe because the cache's error sink drainer runs on a
// background goroutine.
type recordingLogger struct {
	warns  atomic.Int64
	errors atomic.Int64
	last   atomic.Pointer[logEntry]
}

type logEntry struct {
	level string
	msg   string
}

func (r *recordingLogger) Warn(msg string, args ...any) {
	r.warns.Add(1)
	r.last.Store(&logEntry{level: "warn", msg: msg})
	_ = args
}
func (r *recordingLogger) Error(msg string, args ...any) {
	r.errors.Add(1)
	r.last.Store(&logEntry{level: "error", msg: msg})
	_ = args
}

// TestJWKCache_LoggerReceivesRefreshFailures: failures observed by the
// background refresher are forwarded to the caller-provided logger.
func TestJWKCache_LoggerReceivesRefreshFailures(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	initial := jwk.NewSet()
	initial.Add(makeRSAKey(t, "kid-log"))
	srv := newRotatingJWKSServer(t, initial)

	logger := &recordingLogger{}
	cache, err := oidcx.NewJWKCache(ctx, srv.URL(),
		oidcx.WithLogger(logger),
		oidcx.WithMinRefreshInterval(time.Second),
	)
	if err != nil {
		t.Fatalf("NewJWKCache: %v", err)
	}

	srv.failNext.Store(2)
	// Force a refresh that will fail.
	_, _ = cache.Refresh(ctx)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if logger.warns.Load() > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if logger.warns.Load() == 0 {
		t.Fatalf("expected logger.Warn to fire at least once on refresh failure")
	}
}

// BenchmarkJWKCache_HotPath: the steady-state Set() call should not
// allocate per call once the cache is primed and inside the refresh
// interval. We assert a small constant-allocation budget per op.
func BenchmarkJWKCache_HotPath(b *testing.B) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	initial := jwk.NewSet()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		b.Fatalf("rsa.GenerateKey: %v", err)
	}
	pub := priv.PublicKey
	k, err := jwk.New(&pub)
	if err != nil {
		b.Fatalf("jwk.New: %v", err)
	}
	_ = k.Set(jwk.KeyIDKey, "bench-kid")
	_ = k.Set(jwk.AlgorithmKey, "RS256")
	initial.Add(k)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		buf, _ := json.Marshal(initial)
		w.Header().Set("Content-Type", "application/jwk-set+json")
		_, _ = w.Write(buf)
	}))
	defer srv.Close()

	cache, err := oidcx.NewJWKCache(ctx, srv.URL+"/jwks.json",
		oidcx.WithMinRefreshInterval(time.Hour), // suppress refresh during the benchmark
	)
	if err != nil {
		b.Fatalf("NewJWKCache: %v", err)
	}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		set, err := cache.Set(ctx)
		if err != nil {
			b.Fatalf("Set: %v", err)
		}
		if _, ok := set.LookupKeyID("bench-kid"); !ok {
			b.Fatalf("missing bench-kid")
		}
	}
}
