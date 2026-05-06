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
