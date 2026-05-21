package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOnboard_MethodNotAllowed(t *testing.T) {
	srv := New(Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/profiles/onboard", nil)
	srv.HandleOnboard(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d want 405", rec.Code)
	}
	if rec.Header().Get("Allow") != http.MethodPost {
		t.Errorf("Allow=%q want POST", rec.Header().Get("Allow"))
	}
}

func TestOnboard_RejectsMissingFields(t *testing.T) {
	srv := New(Config{})
	cases := []struct {
		name string
		body string
	}{
		{"empty body", `{}`},
		{"missing name", `{"dsn":"quic://x:3141","admin_username":"u","admin_password":"p"}`},
		{"missing dsn", `{"name":"prod","admin_username":"u","admin_password":"p"}`},
		{"missing admin_username", `{"name":"prod","dsn":"quic://x:3141","admin_password":"p"}`},
		{"missing admin_password", `{"name":"prod","dsn":"quic://x:3141","admin_username":"u"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(
				http.MethodPost,
				"/api/v1/profiles/onboard",
				bytes.NewReader([]byte(tc.body)),
			)
			req.Header.Set("Content-Type", "application/json")
			srv.HandleOnboard(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), ErrCodeInvalidRequest) {
				t.Errorf("body=%s want %q", rec.Body.String(), ErrCodeInvalidRequest)
			}
		})
	}
}

func TestOnboard_RejectsInvalidDSNScheme(t *testing.T) {
	srv := New(Config{})
	rec := httptest.NewRecorder()
	body, _ := json.Marshal(map[string]string{
		"name":           "prod",
		"dsn":            "http://example.com:8080",
		"admin_username": "alice",
		"admin_password": "pw",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles/onboard", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.HandleOnboard(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "dsn") {
		t.Errorf("expected dsn-error message; got %s", rec.Body.String())
	}
}
