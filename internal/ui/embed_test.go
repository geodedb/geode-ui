package ui

import (
	"net/http"
	"net/http/httptest"
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
	if rec.Code == http.StatusNotFound {
		t.Fatalf("expected SPA fallback, got 404")
	}
}
