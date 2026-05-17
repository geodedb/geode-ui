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

// TestAudit_LimitClampsToDefault pins PERF #243: when ?limit= is absent
// the handler returns AuditDefaultLimit entries (or fewer if the ring
// is small), not the full ring. With a ring containing 500 entries and
// no ?limit, the response carries AuditDefaultLimit (200), not 500.
func TestAudit_LimitClampsToDefault(t *testing.T) {
	t.Cleanup(resetAuditRing())
	for i := 0; i < 500; i++ {
		emitAudit("x", "user", "alice")
	}
	srv := New(Config{Version: "test"})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit", nil)
	resp, err := srv.Audit(httptest.NewRecorder(), req, &gentypes.AuditQuery{})
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}
	if got, want := len(resp.Entries), AuditDefaultLimit; got != want {
		t.Fatalf("entries len = %d, want default limit %d", got, want)
	}
}

// TestAudit_LimitExplicit honours an explicit ?limit= query param.
func TestAudit_LimitExplicit(t *testing.T) {
	t.Cleanup(resetAuditRing())
	for i := 0; i < 50; i++ {
		emitAudit("x", "user", "alice")
	}
	srv := New(Config{Version: "test"})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit?limit=10", nil)
	resp, err := srv.Audit(httptest.NewRecorder(), req, &gentypes.AuditQuery{})
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}
	if got, want := len(resp.Entries), 10; got != want {
		t.Fatalf("entries len = %d, want %d", got, want)
	}
}

// TestAudit_LimitCappedAtMax caps a deliberately oversized ?limit= at
// AuditMaxLimit so a misbehaving client cannot request a payload larger
// than the ring will ever hold.
func TestAudit_LimitCappedAtMax(t *testing.T) {
	t.Cleanup(resetAuditRing())
	for i := 0; i < 50; i++ {
		emitAudit("x", "user", "alice")
	}
	srv := New(Config{Version: "test"})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit?limit=999999", nil)
	resp, err := srv.Audit(httptest.NewRecorder(), req, &gentypes.AuditQuery{})
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}
	// The ring holds 50, so the response has 50 (capped at min(ring,limit)).
	// The point being asserted: the handler did NOT crash / refuse the
	// oversized limit; it clamped silently.
	if got, want := len(resp.Entries), 50; got != want {
		t.Fatalf("entries len = %d, want %d", got, want)
	}
}

// TestAudit_LimitReturnsMostRecent pins the "show me what just happened"
// semantics: when the ring has more than `limit` matching entries, the
// response carries the TAIL of the ring (most recent), still in
// chronological order. Pre-#243 the handler returned the head — useless
// for an operator dashboard.
func TestAudit_LimitReturnsMostRecent(t *testing.T) {
	t.Cleanup(resetAuditRing())
	for i := 0; i < 10; i++ {
		emitAudit("x", "user", "alice", "i", i)
	}
	srv := New(Config{Version: "test"})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit?limit=3", nil)
	resp, err := srv.Audit(httptest.NewRecorder(), req, &gentypes.AuditQuery{})
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}
	if got, want := len(resp.Entries), 3; got != want {
		t.Fatalf("entries len = %d, want %d", got, want)
	}
	// Most recent 3 entries are i=7, i=8, i=9 in chronological order.
	for k, expectedI := range []int{7, 8, 9} {
		var e auditEntryDecode
		if err := json.Unmarshal(resp.Entries[k], &e); err != nil {
			t.Fatalf("decode entry[%d]: %v", k, err)
		}
		// "i" comes back as a JSON number (float64 after unmarshal).
		got, _ := e.Fields["i"].(float64)
		if int(got) != expectedI {
			t.Errorf("entries[%d].i = %v, want %d", k, got, expectedI)
		}
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
