package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	gentypes "geodedb.com/geode-ui/gen/types"
)

func TestHealthz(t *testing.T) {
	s := New(Config{Version: "v0.0.1-test"})
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	resp, err := s.Healthz(rec, req.WithContext(context.Background()), &gentypes.Empty{})
	if err != nil {
		t.Fatalf("Healthz: %v", err)
	}
	if resp.Status != "ok" {
		t.Fatalf("status=%q want ok", resp.Status)
	}
	if resp.Version != "v0.0.1-test" {
		t.Fatalf("version=%q want v0.0.1-test", resp.Version)
	}
}
