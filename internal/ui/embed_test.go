package ui

import (
	"io"
	"net/http"
	"net/http/httptest"
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
