package server

import (
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// auditEntry is the test-side mirror of AuditEntry — we re-decode the
// jsontext.Value entries the handler returns to assert their shape.
type auditEntryDecode struct {
	Timestamp time.Time      `json:"timestamp"`
	Event     string         `json:"event"`
	Fields    map[string]any `json:"fields"`
}

func TestAudit_NoFilter_ReturnsAllEntries(t *testing.T) {
	t.Cleanup(resetAuditRing())
	emitAudit("login_success", "user", "alice")
	emitAudit("query_executed", "user", "alice", "rows", 3)
	emitAudit("tx_begun", "user", "bob", "txid", "x")

	srv := New(Config{Version: "test"})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit", nil)
	resp, err := srv.Audit(httptest.NewRecorder(), req, &gentypes.AuditQuery{})
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}
	if got, want := len(resp.Entries), 3; got != want {
		t.Fatalf("entries len = %d, want %d", got, want)
	}
}

func TestAudit_EventFilter(t *testing.T) {
	t.Cleanup(resetAuditRing())
	emitAudit("login_success", "user", "alice")
	emitAudit("query_executed", "user", "alice")
	emitAudit("query_executed", "user", "bob")

	srv := New(Config{Version: "test"})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit", nil)
	resp, err := srv.Audit(httptest.NewRecorder(), req, &gentypes.AuditQuery{Event: "query_executed"})
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}
	if got, want := len(resp.Entries), 2; got != want {
		t.Fatalf("entries len = %d, want %d", got, want)
	}
	for i, raw := range resp.Entries {
		var e auditEntryDecode
		if err := json.Unmarshal(raw, &e); err != nil {
			t.Fatalf("decode entry[%d]: %v", i, err)
		}
		if e.Event != "query_executed" {
			t.Errorf("entry[%d].event = %q, want query_executed", i, e.Event)
		}
	}
}

func TestAudit_UserFilter(t *testing.T) {
	t.Cleanup(resetAuditRing())
	emitAudit("query_executed", "user", "alice")
	emitAudit("query_executed", "user", "bob")
	emitAudit("query_executed", "user", "alice")

	srv := New(Config{Version: "test"})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit", nil)
	resp, err := srv.Audit(httptest.NewRecorder(), req, &gentypes.AuditQuery{User: "alice"})
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}
	if got, want := len(resp.Entries), 2; got != want {
		t.Fatalf("entries len = %d, want %d", got, want)
	}
}

func TestAudit_SinceFilter(t *testing.T) {
	t.Cleanup(resetAuditRing())
	emitAudit("x", "user", "alice")
	cut := time.Now().UTC()
	// Sleep one millisecond so the next entry is strictly after cut —
	// time.Now() resolution is fine but test stability matters.
	time.Sleep(2 * time.Millisecond)
	emitAudit("x", "user", "bob")

	srv := New(Config{Version: "test"})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit", nil)
	resp, err := srv.Audit(httptest.NewRecorder(), req, &gentypes.AuditQuery{Since: cut.Format(time.RFC3339Nano)})
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}
	if got, want := len(resp.Entries), 1; got != want {
		t.Fatalf("entries len = %d, want %d", got, want)
	}
}

func TestAudit_BadSinceReturns400(t *testing.T) {
	t.Cleanup(resetAuditRing())
	srv := New(Config{Version: "test"})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit", nil)
	_, err := srv.Audit(httptest.NewRecorder(), req, &gentypes.AuditQuery{Since: "not-a-date"})
	ep := asEndpointError(err)
	if ep == nil {
		t.Fatalf("expected endpointError, got %v", err)
	}
	if ep.status != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", ep.status)
	}
}
