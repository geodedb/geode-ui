package server

import (
	"context"
	"encoding/json"
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

func TestExtractGraphSummary_Path(t *testing.T) {
	rows := [][]any{
		{
			map[string]any{
				"nodes": []any{
					map[string]any{"id": int64(10), "labels": []string{"Person"}, "properties": map[string]any{}},
					map[string]any{"id": int64(11), "labels": []string{"Person"}, "properties": map[string]any{}},
					map[string]any{"id": int64(12), "labels": []string{"Person"}, "properties": map[string]any{}},
				},
				"edges": []any{
					map[string]any{"id": int64(100), "start_node": int64(10), "end_node": int64(11), "type": "KNOWS", "properties": map[string]any{}},
					map[string]any{"id": int64(101), "start_node": int64(11), "end_node": int64(12), "type": "KNOWS", "properties": map[string]any{}},
				},
			},
		},
	}
	got := extractGraphSummary(rows)
	if len(got.Nodes) != 3 {
		t.Fatalf("nodes=%d want 3", len(got.Nodes))
	}
	if len(got.Edges) != 2 {
		t.Fatalf("edges=%d want 2", len(got.Edges))
	}
}

// TestNewLspConfigWithDefaults asserts the canonical default LSP wiring
// that main.go starts from: 127.0.0.1:3142 (the colocated listener Task
// 28 sets up) and Enabled=true. If the bridge default ever flips to
// "off" or to a different upstream port, that should be a conscious
// edit gated on this test.
func TestNewLspConfigWithDefaults(t *testing.T) {
	cfg := NewLspConfigWithDefaults()
	if cfg.UpstreamAddr != "127.0.0.1:3142" {
		t.Fatalf("UpstreamAddr=%q want 127.0.0.1:3142", cfg.UpstreamAddr)
	}
	if !cfg.Enabled {
		t.Fatalf("Enabled=false want true")
	}
}

// TestNewBackfillsLspUpstreamAddr covers the partial-config case: a
// caller passes only Enabled, leaving UpstreamAddr blank. New must
// back-fill UpstreamAddr to the documented default so /ws/lsp dials
// the colocated listener instead of erroring on an empty host:port.
// Enabled is left as-is (bool's zero value is indistinguishable from a
// deliberate disable — callers wanting the full default set should
// start from NewLspConfigWithDefaults).
func TestNewBackfillsLspUpstreamAddr(t *testing.T) {
	srv := New(Config{LSP: LspConfig{Enabled: true}})
	got := srv.LSPConfig()
	if got.UpstreamAddr != "127.0.0.1:3142" {
		t.Fatalf("UpstreamAddr=%q want 127.0.0.1:3142 (back-fill)", got.UpstreamAddr)
	}
	if !got.Enabled {
		t.Fatalf("Enabled=false want true (caller-set value should survive)")
	}
}

// TestNewHonorsExplicitLspConfig asserts the override path: caller
// supplies an explicit LspConfig, New leaves both fields alone. This
// is the path main.go takes — flag defaults populate UpstreamAddr=
// 127.0.0.1:3142 and Enabled=true, but operators can override either
// via -lsp-upstream / -lsp-enabled=false.
func TestNewHonorsExplicitLspConfig(t *testing.T) {
	srv := New(Config{LSP: LspConfig{UpstreamAddr: "10.0.0.5:9999", Enabled: false}})
	got := srv.LSPConfig()
	if got.UpstreamAddr != "10.0.0.5:9999" {
		t.Fatalf("UpstreamAddr=%q want 10.0.0.5:9999", got.UpstreamAddr)
	}
	if got.Enabled {
		t.Fatalf("Enabled=true want false (explicit disable should survive New)")
	}
}

// TestLspConfigJSONRoundTrip asserts the documented field tags
// (upstream_addr, enabled) so any future on-disk runtime config loader
// can unmarshal an "lsp" block straight into LspConfig without having
// to know about a separate intermediate type. Locks down the wire
// names so a careless rename of the Go fields can't silently break
// existing config files.
func TestLspConfigJSONRoundTrip(t *testing.T) {
	raw := []byte(`{"upstream_addr":"10.0.0.5:9000","enabled":false}`)
	var got LspConfig
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.UpstreamAddr != "10.0.0.5:9000" {
		t.Fatalf("UpstreamAddr=%q want 10.0.0.5:9000", got.UpstreamAddr)
	}
	if got.Enabled {
		t.Fatalf("Enabled=true want false (explicit \"enabled\":false)")
	}
	out, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(out) != `{"upstream_addr":"10.0.0.5:9000","enabled":false}` {
		t.Fatalf("marshal=%s want field-name preserving round trip", out)
	}
}

func TestExtractGraphSummary_FloatID(t *testing.T) {
	rows := [][]any{
		{
			map[string]any{"id": float64(7), "labels": []any{"Person"}, "properties": map[string]any{"name": "Carol"}},
		},
	}
	got := extractGraphSummary(rows)
	if len(got.Nodes) != 1 {
		t.Fatalf("nodes=%d want 1 (float id should be tolerated)", len(got.Nodes))
	}
	if got.Nodes[0].ID != 7 {
		t.Fatalf("id=%d want 7", got.Nodes[0].ID)
	}
	if len(got.Nodes[0].Labels) != 1 || got.Nodes[0].Labels[0] != "Person" {
		t.Fatalf("labels=%v want [Person]", got.Nodes[0].Labels)
	}
}
