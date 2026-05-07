package securex

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// buildTokenFor is a bench-local helper mirroring buildToken in secure_test.go
// without the bytes.NewReader allocation; the test-file helper is not in
// scope when the bench file compiles standalone.
func buildTokenFor(secret []byte, method, path, bodyHash, nonce, ts string) string {
	msg := strings.ToUpper(method) + "|" + path + "|" + bodyHash + "|" + nonce + "|" + ts
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(msg))
	return "Bearer " + hex.EncodeToString(mac.Sum(nil))
}

// makeSignedRequest builds a signed request with the given body. The body is
// streamed from a bytes.Reader so the benchmark measures the securex hot
// path, not test-fixture allocation.
func makeSignedRequest(secret []byte, body []byte) *http.Request {
	sum := sha256.Sum256(body)
	bodyHash := hex.EncodeToString(sum[:])
	nonce := "nonce-bench"
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/bench", bytes.NewReader(body))
	r.Header.Set("Authorization", buildTokenFor(secret, r.Method, r.URL.Path, bodyHash, nonce, ts))
	r.Header.Set("X-Nonce", nonce)
	r.Header.Set("X-Timestamp", ts)
	return r
}

// TestAPIKeyAuthWithLimit_WithinCap proves that a body at exactly the limit
// is accepted and the request body can still be re-read downstream.
func TestAPIKeyAuthWithLimit_WithinCap(t *testing.T) {
	secret := []byte("supersecret")
	var seen sync.Map
	body := bytes.Repeat([]byte("a"), 1024)
	r := makeSignedRequest(secret, body)
	if err := APIKeyAuthWithLimit(r, secret, 5*time.Minute, &seen, 1024); err != nil {
		t.Fatalf("expected auth success at cap, got %v", err)
	}
	got, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatalf("body rewrap: %v", err)
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("body not preserved through auth (got %d bytes, want %d)", len(got), len(body))
	}
}

// TestAPIKeyAuthWithLimit_OverCap proves that a body one byte over the
// limit is rejected with ErrBodyTooLarge. This is the core PERF-0012
// safeguard: an attacker cannot force the server to buffer an arbitrarily
// large body just to produce a HMAC hash.
func TestAPIKeyAuthWithLimit_OverCap(t *testing.T) {
	secret := []byte("supersecret")
	var seen sync.Map
	body := bytes.Repeat([]byte("a"), 1025)
	r := makeSignedRequest(secret, body)
	err := APIKeyAuthWithLimit(r, secret, 5*time.Minute, &seen, 1024)
	if err == nil {
		t.Fatal("expected rejection for body exceeding cap")
	}
	if !errors.Is(err, ErrBodyTooLarge) {
		t.Fatalf("expected ErrBodyTooLarge, got %v", err)
	}
}

// TestAPIKeyAuthWithLimit_EmptyBody proves that a missing body is treated
// as zero bytes and still produces a reproducible HMAC.
func TestAPIKeyAuthWithLimit_EmptyBody(t *testing.T) {
	secret := []byte("supersecret")
	var seen sync.Map
	r := makeSignedRequest(secret, nil)
	if err := APIKeyAuthWithLimit(r, secret, 5*time.Minute, &seen, 1024); err != nil {
		t.Fatalf("empty body should auth cleanly, got %v", err)
	}
}

// TestAPIKeyAuthWithLimit_ZeroLimitMeansDefault proves that passing 0 for
// the limit resolves to the package-level default (defaultHMACBodyLimit)
// so that downstream callers that have not yet migrated are still protected.
func TestAPIKeyAuthWithLimit_ZeroLimitMeansDefault(t *testing.T) {
	secret := []byte("supersecret")
	var seen sync.Map
	body := []byte(`{"x":"y"}`)
	r := makeSignedRequest(secret, body)
	if err := APIKeyAuthWithLimit(r, secret, 5*time.Minute, &seen, 0); err != nil {
		t.Fatalf("expected success with zero limit (defaulting), got %v", err)
	}
}

// TestAPIKeyAuth_StillStreamed proves that the existing APIKeyAuth wrapper
// (public backward-compat entry point) now uses the LimitReader path and
// refuses pathologically large bodies. The pre-fix code would happily
// buffer the entire body into memory.
func TestAPIKeyAuth_StillStreamed(t *testing.T) {
	secret := []byte("supersecret")
	var seen sync.Map
	// 16 MiB - larger than the default cap.
	body := bytes.Repeat([]byte("x"), 16*1024*1024)
	r := makeSignedRequest(secret, body)
	err := APIKeyAuth(r, secret, 5*time.Minute, &seen)
	if err == nil {
		t.Fatal("expected APIKeyAuth to reject a 16 MiB body under the default cap")
	}
	if !errors.Is(err, ErrBodyTooLarge) && !errors.Is(err, ErrAuthFailed) {
		t.Fatalf("expected ErrBodyTooLarge (or ErrAuthFailed wrapping it); got %v", err)
	}
}

// BenchmarkHMACBody_1MB measures the per-op cost of hashing a 1 MiB request
// body. With streaming + LimitReader, allocation growth should be O(1) in
// body size.
func BenchmarkHMACBody_1MB(b *testing.B) {
	benchmarkHMACBody(b, 1*1024*1024)
}

// BenchmarkHMACBody_10MB measures 10 MiB body hashing; alloc should not
// scale linearly with the body size (streaming invariant).
func BenchmarkHMACBody_10MB(b *testing.B) {
	benchmarkHMACBody(b, 10*1024*1024)
}

// BenchmarkHMACBody_100MB measures 100 MiB body hashing; this is the
// upper-range sanity check for the O(1) invariant. The default cap
// rejects it, so bench runs with an explicit higher cap.
func BenchmarkHMACBody_100MB(b *testing.B) {
	benchmarkHMACBody(b, 100*1024*1024)
}

func benchmarkHMACBody(b *testing.B, n int) {
	secret := []byte("supersecret")
	body := bytes.Repeat([]byte{0x61}, n)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		r := makeSignedRequest(secret, body)
		// Use an over-sized limit so the bench measures streaming, not
		// reject-paths.
		seen := sync.Map{}
		if err := APIKeyAuthWithLimit(r, secret, 5*time.Minute, &seen, int64(n)+1); err != nil {
			b.Fatalf("auth: %v", err)
		}
	}
}
