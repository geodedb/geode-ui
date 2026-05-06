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

func TestExtractGraphSummary(t *testing.T) {
	rows := [][]any{
		{
			map[string]any{"id": int64(1), "labels": []string{"Person"}, "properties": map[string]any{"name": "Alice"}},
			map[string]any{"id": int64(2), "start_node": int64(1), "end_node": int64(3), "type": "KNOWS", "properties": map[string]any{}},
		},
		{
			map[string]any{"id": int64(3), "labels": []string{"Person"}, "properties": map[string]any{"name": "Bob"}},
			map[string]any{"id": int64(1), "labels": []string{"Person"}, "properties": map[string]any{"name": "Alice (dup)"}}, // duplicate
		},
	}
	got := extractGraphSummary(rows)
	if len(got.Nodes) != 2 {
		t.Fatalf("nodes=%d want 2", len(got.Nodes))
	}
	if len(got.Edges) != 1 {
		t.Fatalf("edges=%d want 1", len(got.Edges))
	}
}
