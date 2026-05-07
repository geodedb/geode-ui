package server

import (
	"bytes"
	"encoding/json/v2"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
)

// resetAuditRing returns a function that restores the package-level
// defaultAuditRing. Tests that exercise emitAudit must call it via
// `t.Cleanup(resetAuditRing())` to avoid bleeding entries across tests
// (Go's test runner shares process state between sequential tests in
// the same package).
func resetAuditRing() func() {
	prev := defaultAuditRing
	defaultAuditRing = newAuditRing()
	return func() { defaultAuditRing = prev }
}

func TestAuditRing_AppendAndSnapshot(t *testing.T) {
	t.Cleanup(resetAuditRing())
	for i := 0; i < 5; i++ {
		defaultAuditRing.append(AuditEntry{
			Timestamp: time.Date(2026, 5, 6, 12, i, 0, 0, time.UTC),
			Event:     "tx_begun",
			Fields:    map[string]any{"i": i},
		})
	}
	got := defaultAuditRing.snapshot(time.Time{})
	if len(got) != 5 {
		t.Fatalf("snapshot len = %d, want 5", len(got))
	}
	// Chronological order preserved
	for i, e := range got {
		if v := e.Fields["i"]; v != i {
			t.Errorf("entry[%d].i = %v, want %d", i, v, i)
		}
	}
}

func TestAuditRing_FilterSince(t *testing.T) {
	t.Cleanup(resetAuditRing())
	base := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 5; i++ {
		defaultAuditRing.append(AuditEntry{
			Timestamp: base.Add(time.Duration(i) * time.Minute),
			Event:     "x",
			Fields:    map[string]any{"i": i},
		})
	}
	got := defaultAuditRing.snapshot(base.Add(2 * time.Minute))
	if len(got) != 3 {
		t.Fatalf("snapshot len = %d, want 3", len(got))
	}
	if v := got[0].Fields["i"]; v != 2 {
		t.Errorf("first entry.i = %v, want 2", v)
	}
}

func TestAuditRing_WrapAround(t *testing.T) {
	// Force a small ring by stack-allocating one — the package-level
	// auditBufferCap is too large to overflow in a unit test.
	r := &auditRing{buf: make([]AuditEntry, 3)}
	for i := 0; i < 5; i++ {
		r.append(AuditEntry{
			Timestamp: time.Unix(int64(i), 0),
			Event:     "x",
			Fields:    map[string]any{"i": i},
		})
	}
	got := r.snapshot(time.Time{})
	if len(got) != 3 {
		t.Fatalf("snapshot len = %d, want 3", len(got))
	}
	// After 5 appends to a 3-slot ring we should see entries 2,3,4
	for idx, want := range []int{2, 3, 4} {
		if v := got[idx].Fields["i"]; v != want {
			t.Errorf("got[%d].i = %v, want %d", idx, v, want)
		}
	}
}

func TestAuditRing_ConcurrentAppend(t *testing.T) {
	r := &auditRing{buf: make([]AuditEntry, 256)}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				r.append(AuditEntry{Event: "x", Fields: map[string]any{"i": i, "j": j}})
			}
		}(i)
	}
	wg.Wait()
	got := r.snapshot(time.Time{})
	if len(got) != 160 {
		t.Errorf("snapshot len = %d, want 160", len(got))
	}
}

func TestEmitAudit_RedactsSensitiveKeys(t *testing.T) {
	t.Cleanup(resetAuditRing())
	emitAudit("login_success",
		"user", "alice",
		"password", "hunter2",
		"client_secret", "shhh",
		"jwt_token", "deadbeef",
	)
	got := defaultAuditRing.snapshot(time.Time{})
	if len(got) != 1 {
		t.Fatalf("snapshot len = %d, want 1", len(got))
	}
	f := got[0].Fields
	if f["user"] != "alice" {
		t.Errorf("user not preserved: %v", f["user"])
	}
	for _, k := range []string{"password", "client_secret", "jwt_token"} {
		if f[k] != "[REDACTED]" {
			t.Errorf("key %q not redacted: %v", k, f[k])
		}
	}
}

func TestEmitAudit_SlogOutputContainsEvent(t *testing.T) {
	t.Cleanup(resetAuditRing())
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	emitAudit("query_executed", "user", "alice", "rows", 42)

	out := buf.String()
	if !strings.Contains(out, `"event":"query_executed"`) {
		t.Errorf("slog output missing event: %s", out)
	}
	if !strings.Contains(out, `"user":"alice"`) {
		t.Errorf("slog output missing user: %s", out)
	}
}

func TestIsSensitive(t *testing.T) {
	cases := []struct {
		key  string
		want bool
	}{
		{"user", false},
		{"password", true},
		{"NEW_PASSWORD", true},
		{"client_secret", true},
		{"access_token", true},
		{"jwt", true},
		{"private_key", true},
		{"profile", false},
		{"event", false},
	}
	for _, c := range cases {
		if got := isSensitive(c.key); got != c.want {
			t.Errorf("isSensitive(%q) = %v, want %v", c.key, got, c.want)
		}
	}
}

func TestEmitAudit_SkipsOddTrailingArg(t *testing.T) {
	t.Cleanup(resetAuditRing())
	// Odd number of kv args should not panic; trailing arg is ignored.
	emitAudit("x", "user", "alice", "lone")
	got := defaultAuditRing.snapshot(time.Time{})
	if len(got) != 1 {
		t.Fatalf("snapshot len = %d, want 1", len(got))
	}
	if _, ok := got[0].Fields["lone"]; ok {
		t.Errorf("trailing arg should not produce a key")
	}
}

func TestAuditEntry_RoundTripJSON(t *testing.T) {
	e := AuditEntry{
		Timestamp: time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC),
		Event:     "tx_begun",
		Fields:    map[string]any{"user": "alice", "txid": "abc"},
	}
	raw, err := json.Marshal(e)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got AuditEntry
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Event != e.Event {
		t.Errorf("event mismatch: %q vs %q", got.Event, e.Event)
	}
}
