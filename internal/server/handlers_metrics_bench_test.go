package server

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha1" // #nosec G505 — required by HIBP k-anonymity, mirrors password_policy.go.
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"geodedb.com/geode-ui/internal/jwt"
)

// newBenchIssuer constructs a *jwt.Issuer suitable for the metrics
// benchmark — same shape as newTestIssuer but rooted at *testing.B.
func newBenchIssuer(b *testing.B) *jwt.Issuer {
	b.Helper()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		b.Fatalf("rand: %v", err)
	}
	iss, err := jwt.NewIssuer(key, time.Hour)
	if err != nil {
		b.Fatalf("NewIssuer: %v", err)
	}
	return iss
}

// hibpSuffixFor returns the upper-case hex SHA-1 of pw with the first
// 5 chars removed — the suffix the HIBP body responder echoes back.
func hibpSuffixFor(pw string) string {
	h := sha1.Sum([]byte(pw)) // #nosec G401 — same rationale as password_policy.go
	return strings.ToUpper(hex.EncodeToString(h[:]))[5:]
}

// PERF-2026-05-21-01 (Item 2, 2026-05-21 audit): the five hot paths
// the audit flagged as having no bench coverage. Each benchmark
// drives the function with realistic input shape captured from prod
// (or recreated minimally for paths whose real input is upstream-
// dependent), uses b.ReportAllocs to anchor allocation regressions,
// and avoids any sleep / network I/O so the bench-gate run stays
// deterministic.

// loadPromSample reads the on-tree Prometheus exposition sample used
// by promparse_test.go. Cached per-process so the helper does not
// re-stat the file on every -count iteration.
var promSampleBytes []byte

func loadPromSample(b *testing.B) []byte {
	b.Helper()
	if promSampleBytes != nil {
		return promSampleBytes
	}
	data, err := os.ReadFile("testdata/prom-geode-sample.txt")
	if err != nil {
		b.Fatalf("read prom sample: %v", err)
	}
	promSampleBytes = data
	return data
}

// BenchmarkParseProm anchors the cost of converting a real Geode
// Prometheus exposition into the []MetricFamily shape downstream
// code consumes. This is invoked on every successful 5s metrics
// poll, so a regression here multiplies by every open SPA tab.
func BenchmarkParseProm(b *testing.B) {
	sample := loadPromSample(b)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, err := ParseProm(bytes.NewReader(sample))
		if err != nil {
			b.Fatalf("ParseProm: %v", err)
		}
	}
}

// BenchmarkProjectSnapshot anchors the FindFamily / typed-projection
// pass that runs after ParseProm on every metrics poll. The current
// implementation does ~11 linear FindFamily walks per call (perf-
// reviewer #6); a future optimisation that fronts FindFamily with a
// map will show as a delta here.
func BenchmarkProjectSnapshot(b *testing.B) {
	sample := loadPromSample(b)
	fams, err := ParseProm(bytes.NewReader(sample))
	if err != nil {
		b.Fatalf("ParseProm setup: %v", err)
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = projectSnapshot(fams)
	}
}

// BenchmarkHandleMetrics drives the full /api/v1/metrics handler
// end-to-end against an in-process upstream that serves the sample
// exposition. Captures the cost the SPA dashboard pays on every
// poll: request build → http.Client.Do → ParseProm → projectSnapshot
// → JSON encode. Auth is bypassed because the AuthJWT branch is
// guarded by a known-impl exemption when Config.JWT is nil + the
// route is unmounted; for the benchmark we exercise the post-auth
// path directly by injecting a Config.MetricsHTTPClient that
// short-circuits the network.
func BenchmarkHandleMetrics(b *testing.B) {
	sample := loadPromSample(b)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		_, _ = w.Write(sample)
	}))
	defer upstream.Close()

	iss := newBenchIssuer(b)
	tok, _, err := iss.Issue("alice", "default", []string{"reader"}, "")
	if err != nil {
		b.Fatalf("Issue: %v", err)
	}

	s := New(Config{
		Version:    "bench",
		MetricsURL: upstream.URL,
		JWT:        iss,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/metrics", nil)
	req.Header.Set("Authorization", "Bearer "+tok)

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		rec := httptest.NewRecorder()
		s.HandleMetrics(rec, req)
		if rec.Code != http.StatusOK {
			b.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
		}
	}
}

// BenchmarkLspFrameReader_ReadFrame measures the byte-by-byte LSP
// header reader (ws_lsp.go:351). Perf-reviewer #4: the current loop
// allocates 1-byte buffers + appends per byte, and uppercase-folds
// the whole header per frame for the Content-Length lookup. A
// bufio-wrapped or single-allocation rewrite shows as a delta here.
func BenchmarkLspFrameReader_ReadFrame(b *testing.B) {
	// Build a realistic LSP frame: header + body. Keep the body small
	// (the worst case is the header scan, not the body copy).
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`)
	header := []byte("Content-Length: " + itoaPrefix(len(body)) + "\r\n\r\n")
	frame := append(append([]byte{}, header...), body...)
	// Repeat the frame so b.N iterations always have bytes to read.
	stream := bytes.Repeat(frame, 1024)

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		r := newLspFrameReader(bytes.NewReader(stream))
		// Read one frame per iteration; b.N controls how many total.
		_, err := r.ReadFrame()
		if err != nil {
			b.Fatalf("ReadFrame: %v", err)
		}
	}
}

// itoaPrefix is a tiny allocation-free integer formatter used by the
// LSP frame builder above. Avoids strconv to keep the benchmark
// itself out of strconv's micro-cost.
func itoaPrefix(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// BenchmarkHIBPHasSeen drives the password-policy HIBP range-fetch
// against an in-process upstream so the bench measures the response
// parser (sha1 → range fetch → suffix scan) without leaving the
// host. Perf-reviewer #3: this is one of the call sites tuned by
// the shared http.Transport singleton; the benchmark anchors both
// the keep-alive reuse win and any future scan-loop optimisation.
func BenchmarkHIBPHasSeen(b *testing.B) {
	// Realistic 5-char-prefix response: 800 padded rows + one row
	// with the suffix we will probe so the "found" branch is the
	// thing measured. The shape mirrors api.pwnedpasswords.com.
	probe := "P@ssword-bench-1!"
	var body bytes.Buffer
	// 800 padding rows (count=0) — HIBP returns these when -h Add-Padding=true
	for i := 0; i < 800; i++ {
		body.WriteString(itoaPrefix(i + 100000))
		body.WriteString("0000000000000000000000000000000:0\r\n")
	}
	// One row carrying the suffix of sha1(probe) so the scan finds it.
	// Computed inline at bench-setup time so the test is sealed.
	suffix := hibpSuffixFor(probe)
	body.WriteString(suffix + ":7\r\n")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.Copy(w, strings.NewReader(body.String()))
	}))
	defer srv.Close()

	policy := PasswordPolicy{HIBPCheck: true, HIBPEndpoint: srv.URL + "/"}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		seen, err := hibpHasSeen(context.Background(), probe, policy)
		if err != nil {
			b.Fatalf("hibpHasSeen: %v", err)
		}
		if !seen {
			b.Fatal("expected suffix match in fixed corpus")
		}
	}
}
