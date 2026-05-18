package ui

import (
	"bytes"
	"compress/gzip"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// countingFS wraps an fs.FS and counts every Stat() call, keyed by
// requested path. Used by TestEmbedHandler_CachesStat to assert that
// the second HTTP request for a static asset does NOT call fs.Stat a
// second time (the FileInfo is cached).
type countingFS struct {
	inner fs.FS
	stats sync.Map // key: string path, value: *atomic.Int64
}

func (c *countingFS) statCount(name string) int64 {
	if v, ok := c.stats.Load(name); ok {
		return v.(*atomic.Int64).Load()
	}
	return 0
}

func (c *countingFS) Open(name string) (fs.File, error) {
	return c.inner.Open(name)
}

// fs.StatFS optimisation: fs.Stat dispatches to StatFS.Stat if
// implemented, avoiding an Open+Stat+Close round trip. Implementing
// StatFS lets us count the package-level fs.Stat(c, name) calls
// directly.
func (c *countingFS) Stat(name string) (fs.FileInfo, error) {
	var n *atomic.Int64
	if v, ok := c.stats.Load(name); ok {
		n = v.(*atomic.Int64)
	} else {
		ni := &atomic.Int64{}
		actual, _ := c.stats.LoadOrStore(name, ni)
		n = actual.(*atomic.Int64)
	}
	n.Add(1)
	return fs.Stat(c.inner, name)
}

func TestHandlerServesIndexForUnknownPaths(t *testing.T) {
	h, err := Handler()
	if err != nil {
		t.Fatalf("Handler: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/some/spa/route", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 (SPA fallback to index.html)", rec.Code)
	}
	body, _ := io.ReadAll(rec.Body)
	if !strings.Contains(string(body), "<!doctype html") && !strings.Contains(string(body), "<!DOCTYPE html") {
		preview := body
		if len(preview) > 256 {
			preview = preview[:256]
		}
		t.Fatalf("body does not look like the SPA index; got first 256 bytes:\n%s", preview)
	}
}

func TestHandlerServesNamedAsset(t *testing.T) {
	h, err := Handler()
	if err != nil {
		t.Fatalf("Handler: %v", err)
	}
	// /favicon.ico is shipped in dist/ and exercises the "file exists,
	// do not rewrite" branch without triggering FileServer's
	// /index.html → / redirect quirk.
	req := httptest.NewRequest(http.MethodGet, "/favicon.ico", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 for /favicon.ico", rec.Code)
	}
}

// TestHandler404sMissingAssetShapedPaths guards the regression that
// motivated the asset-extension guard: a stale browser-cached
// index.html requesting a bundle filename that no longer exists must
// 404, not receive index.html-as-JavaScript.
func TestHandler404sMissingAssetShapedPaths(t *testing.T) {
	h, err := Handler()
	if err != nil {
		t.Fatalf("Handler: %v", err)
	}
	cases := []string{
		"/main.deadbeef00112233445566778899aabb.js",
		"/vendors.cafef00d11223344556677889900aabb.css",
		"/some/missing/sprite.png",
		"/missing.woff2",
	}
	for _, p := range cases {
		t.Run(p, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, p, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != http.StatusNotFound {
				t.Fatalf("status=%d want 404 for missing asset %q", rec.Code, p)
			}
			ct := rec.Header().Get("Content-Type")
			if strings.Contains(ct, "text/html") {
				t.Fatalf("Content-Type=%q want non-html for missing asset %q", ct, p)
			}
		})
	}
}

// findLargeJSAsset returns the dist-relative path of a .js bundle of at
// least minCompressSize bytes, plus its raw bytes. Fails the test if no
// such file is embedded (the SPA always has a main bundle well over 1 KiB).
func findLargeJSAsset(t *testing.T) (string, []byte) {
	t.Helper()
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		t.Fatalf("fs.Sub: %v", err)
	}
	var found string
	_ = fs.WalkDir(sub, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || found != "" {
			return nil //nolint:nilerr // best-effort walk
		}
		if strings.ToLower(path.Ext(p)) != ".js" {
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() < minCompressSize {
			return nil //nolint:nilerr
		}
		found = p
		return nil
	})
	if found == "" {
		t.Skip("no .js asset >= minCompressSize embedded; nothing to test")
	}
	raw, err := fs.ReadFile(sub, found)
	if err != nil {
		t.Fatalf("ReadFile(%s): %v", found, err)
	}
	return found, raw
}

// TestHandlerGzipsLargeJSAsset is the PSR-F5 acceptance test: a request
// for a sizeable .js bundle with Accept-Encoding: gzip must come back
// Content-Encoding: gzip + Vary: Accept-Encoding, and the decompressed
// body must byte-match the embedded asset.
//
// PERF (#259): the brotli precompression added in `acceptsBrotli` takes
// precedence over on-the-fly gzip when the client advertises br AND
// a .br sibling exists. This test deliberately uses a gzip-only
// Accept-Encoding so the gzip path is exercised; the brotli precedence
// is covered by TestHandlerServesBrotliWhenAccepted below.
func TestHandlerGzipsLargeJSAsset(t *testing.T) {
	h, err := Handler()
	if err != nil {
		t.Fatalf("Handler: %v", err)
	}
	name, raw := findLargeJSAsset(t)

	req := httptest.NewRequest(http.MethodGet, "/"+name, nil)
	req.Header.Set("Accept-Encoding", "gzip, deflate")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 for /%s", rec.Code, name)
	}
	if ce := rec.Header().Get("Content-Encoding"); ce != "gzip" {
		t.Fatalf("Content-Encoding=%q want gzip", ce)
	}
	if v := rec.Header().Get("Vary"); !strings.Contains(v, "Accept-Encoding") {
		t.Fatalf("Vary=%q want it to contain Accept-Encoding", v)
	}
	if cl := rec.Header().Get("Content-Length"); cl != "" {
		// A wrong (uncompressed) Content-Length would desync the client;
		// chunked transfer (empty CL) is the correct outcome here.
		t.Fatalf("Content-Length=%q want empty for a gzip-streamed body", cl)
	}
	// The wire body must be smaller than the raw asset (these bundles
	// compress well) and must decode back to exactly the raw bytes.
	wire := rec.Body.Bytes()
	if len(wire) >= len(raw) {
		t.Fatalf("gzip body (%d B) not smaller than raw asset (%d B)", len(wire), len(raw))
	}
	gr, err := gzip.NewReader(bytes.NewReader(wire))
	if err != nil {
		t.Fatalf("gzip.NewReader: %v", err)
	}
	got, err := io.ReadAll(gr)
	if err != nil {
		t.Fatalf("gzip read: %v", err)
	}
	if err := gr.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}
	if !bytes.Equal(got, raw) {
		t.Fatalf("decompressed body (%d B) does not match raw asset (%d B)", len(got), len(raw))
	}
}

// TestHandlerNoGzipWithoutAcceptEncoding: a client that doesn't
// advertise gzip gets the raw bytes (no Content-Encoding) but the
// response still carries Vary: Accept-Encoding so a shared cache won't
// hand a gzipped copy to such a client later.
func TestHandlerNoGzipWithoutAcceptEncoding(t *testing.T) {
	h, err := Handler()
	if err != nil {
		t.Fatalf("Handler: %v", err)
	}
	name, raw := findLargeJSAsset(t)

	req := httptest.NewRequest(http.MethodGet, "/"+name, nil)
	// no Accept-Encoding header
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200", rec.Code)
	}
	if ce := rec.Header().Get("Content-Encoding"); ce != "" {
		t.Fatalf("Content-Encoding=%q want empty (client did not request gzip)", ce)
	}
	if v := rec.Header().Get("Vary"); !strings.Contains(v, "Accept-Encoding") {
		t.Fatalf("Vary=%q want it to contain Accept-Encoding", v)
	}
	if !bytes.Equal(rec.Body.Bytes(), raw) {
		t.Fatalf("body (%d B) does not match raw asset (%d B)", rec.Body.Len(), len(raw))
	}
}

// TestHandlerNoGzipForBinaryAsset: a font/image is on no compressible
// list, so even with Accept-Encoding: gzip it is served raw with neither
// Content-Encoding nor Vary (re-compressing it is pure waste).
func TestHandlerNoGzipForBinaryAsset(t *testing.T) {
	h, err := Handler()
	if err != nil {
		t.Fatalf("Handler: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/favicon.ico", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 for /favicon.ico", rec.Code)
	}
	if ce := rec.Header().Get("Content-Encoding"); ce != "" {
		t.Fatalf("Content-Encoding=%q want empty for binary asset", ce)
	}
	if v := rec.Header().Get("Vary"); strings.Contains(v, "Accept-Encoding") {
		t.Fatalf("Vary=%q should not mention Accept-Encoding for an incompressible asset", v)
	}
}

// TestHandlerServesBrotliWhenAccepted pins PERF (#259): when the
// client accepts `br` AND a `.br` precompressed sibling exists in the
// embedded FS, the handler returns the precompressed bytes verbatim
// with `Content-Encoding: br` + `Vary: Accept-Encoding`. Brotli
// precedence over gzip is the load-bearing assertion: a client that
// accepts both MUST receive br (the quality-11 precompressed sibling
// is meaningfully smaller than the on-the-fly q1 gzip).
func TestHandlerServesBrotliWhenAccepted(t *testing.T) {
	h, err := Handler()
	if err != nil {
		t.Fatalf("Handler: %v", err)
	}
	name, raw := findLargeJSAsset(t)

	req := httptest.NewRequest(http.MethodGet, "/"+name, nil)
	req.Header.Set("Accept-Encoding", "gzip, deflate, br")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 for /%s", rec.Code, name)
	}
	if ce := rec.Header().Get("Content-Encoding"); ce != "br" {
		t.Fatalf("Content-Encoding=%q want br (brotli must take precedence over gzip)", ce)
	}
	if v := rec.Header().Get("Vary"); !strings.Contains(v, "Accept-Encoding") {
		t.Fatalf("Vary=%q want it to contain Accept-Encoding", v)
	}
	if cl := rec.Header().Get("Content-Length"); cl == "" {
		t.Fatalf("Content-Length is empty; brotli sibling has a known size and must declare it")
	}
	// Wire body must be smaller than the raw asset.
	wire := rec.Body.Bytes()
	if len(wire) >= len(raw) {
		t.Fatalf("br body (%d B) not smaller than raw asset (%d B)", len(wire), len(raw))
	}
}

// TestHandlerSkipsBrotliWhenClientDoesntAccept: a client whose
// Accept-Encoding excludes `br` falls through to the on-the-fly gzip
// path even though the .br sibling exists.
func TestHandlerSkipsBrotliWhenClientDoesntAccept(t *testing.T) {
	h, err := Handler()
	if err != nil {
		t.Fatalf("Handler: %v", err)
	}
	name, _ := findLargeJSAsset(t)

	req := httptest.NewRequest(http.MethodGet, "/"+name, nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if ce := rec.Header().Get("Content-Encoding"); ce != "gzip" {
		t.Fatalf("Content-Encoding=%q want gzip (brotli must not be served when client did not accept it)", ce)
	}
}

// TestAcceptsBrotli exercises the Accept-Encoding parser corner cases
// for the `br` token. Mirrors TestAcceptsGzip's shape.
func TestAcceptsBrotli(t *testing.T) {
	cases := []struct {
		hdr  string
		want bool
	}{
		{"", false},
		{"br", true},
		{"gzip, deflate, br", true},
		{"deflate, br", true},
		{"BR", true},
		{"br;q=1.0", true},
		{"br;q=0.5", true},
		{"br;q=0", false},
		{"br; q=0", false},
		{"identity", false},
		{"*", true},
		{"*;q=0", false},
		{"gzip, *", true},
		{"gzip", false}, // gzip-only must not match br
	}
	for _, c := range cases {
		t.Run(c.hdr, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/x.js", nil)
			if c.hdr != "" {
				r.Header.Set("Accept-Encoding", c.hdr)
			}
			if got := acceptsBrotli(r); got != c.want {
				t.Fatalf("acceptsBrotli(%q) = %v, want %v", c.hdr, got, c.want)
			}
		})
	}
}

// TestAcceptsGzip exercises the Accept-Encoding parser corner cases.
func TestAcceptsGzip(t *testing.T) {
	cases := []struct {
		hdr  string
		want bool
	}{
		{"", false},
		{"gzip", true},
		{"gzip, deflate, br", true},
		{"deflate, gzip", true},
		{"GZIP", true},
		{"gzip;q=1.0", true},
		{"gzip;q=0.5", true},
		{"gzip;q=0", false},
		{"gzip; q=0", false},
		{"identity", false},
		{"*", true},
		{"*;q=0", false},
		{"br, *", true},
	}
	for _, c := range cases {
		t.Run(c.hdr, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/x.js", nil)
			if c.hdr != "" {
				r.Header.Set("Accept-Encoding", c.hdr)
			}
			if got := acceptsGzip(r); got != c.want {
				t.Fatalf("acceptsGzip(%q) = %v, want %v", c.hdr, got, c.want)
			}
		})
	}
}

// TestEmbedHandler_CachesStat pins PERF-2026-05-13-02 / GAP-022 /
// PSR-F5 (#103): the embed FS is immutable post-build, so a fs.Stat
// for a static asset path should hit on the first request and serve
// out of an in-memory cache thereafter. Two requests for the same
// existing path must produce exactly ONE fs.Stat call to the
// underlying FS.
//
// Negative results (missing-asset 404s) are NOT cached — caching them
// would let attacker-shaped URLs grow the map unboundedly. The
// 404 path is exercised separately in TestEmbedHandler_DoesNotCache404.
//
// The test exercises /favicon.ico (a real shipped asset whose path is
// stable across builds and which avoids http.FileServer's index.html
// → / redirect quirk).
func TestEmbedHandler_CachesStat(t *testing.T) {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		t.Fatalf("fs.Sub: %v", err)
	}
	cfs := &countingFS{inner: sub}
	h, err := handlerFS(cfs)
	if err != nil {
		t.Fatalf("handlerFS: %v", err)
	}
	const assetURL = "/favicon.ico"
	const assetPath = "favicon.ico"
	// First request — must Stat the underlying FS at least once.
	req := httptest.NewRequest(http.MethodGet, assetURL, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("first request status=%d want 200", rec.Code)
	}
	first := cfs.statCount(assetPath)
	if first < 1 {
		t.Fatalf("first request expected ≥1 Stat call, got %d", first)
	}

	// Second request to the same path. The cache must hit; no new
	// Stat call on the underlying FS.
	req = httptest.NewRequest(http.MethodGet, assetURL, nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("second request status=%d want 200", rec.Code)
	}
	second := cfs.statCount(assetPath)
	if second != first {
		t.Fatalf("second request Stat count=%d want %d (cache must hit; no new Stat)",
			second, first)
	}
}

// TestEmbedHandler_DoesNotCache404 guards the negative-result cache
// boundary: missing asset-shaped paths must 404 every time and must
// NOT add an entry to the Stat cache. Caching 404s would let an
// attacker grow the map without bound by requesting random
// `*.js`/`*.css` filenames.
func TestEmbedHandler_DoesNotCache404(t *testing.T) {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		t.Fatalf("fs.Sub: %v", err)
	}
	cfs := &countingFS{inner: sub}
	h, err := handlerFS(cfs)
	if err != nil {
		t.Fatalf("handlerFS: %v", err)
	}
	const missing = "/totally-not-a-real-asset-abc123.js"
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, missing, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("iter %d: status=%d want 404", i, rec.Code)
		}
	}
	// Each 404 request should have hit the underlying FS (no caching of
	// missing entries). Allow >=3, no exact equality, because internal
	// implementation may make small adjustments — what matters is that
	// the count is NOT 1 (which would indicate negative caching).
	got := cfs.statCount(strings.TrimPrefix(missing, "/"))
	if got < 3 {
		t.Fatalf("missing asset Stat count=%d want ≥3 (negative results must not be cached)", got)
	}
}

// TestHandlerNoCacheOnIndexHTML guards the regression that motivated
// the Cache-Control override: a browser must always re-validate the
// HTML response so a rebuild's new hashed bundle filenames flow in
// immediately.
func TestHandlerNoCacheOnIndexHTML(t *testing.T) {
	h, err := Handler()
	if err != nil {
		t.Fatalf("Handler: %v", err)
	}
	for _, p := range []string{"/", "/login", "/some/spa/route"} {
		t.Run(p, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, p, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			cc := rec.Header().Get("Cache-Control")
			if !strings.Contains(cc, "no-cache") {
				t.Fatalf("Cache-Control=%q want no-cache for HTML response on %q", cc, p)
			}
		})
	}
}
