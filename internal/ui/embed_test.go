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
	"testing"
)

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
func TestHandlerGzipsLargeJSAsset(t *testing.T) {
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
