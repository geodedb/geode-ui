package server

import (
	"bytes"
	"context"
	"encoding/json/v2"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
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
	for i := range 5 {
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
	for i := range 5 {
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
	for i := range 5 {
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
	for i := range 16 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := range 10 {
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

// TestAuditRing_SnapshotSinceExact pins the PERF-2026-05-11-06 (#142)
// contract on the sequential path: snapshot(since) returns EXACTLY the
// entries whose Timestamp is >= since, in chronological (ring) order,
// and the result slice is sized to the match count (not to the whole
// ring). Exercised with and without a wrap.
func TestAuditRing_SnapshotSinceExact(t *testing.T) {
	base := time.Date(2026, 5, 11, 9, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name    string
		ringCap int
		n       int // entries appended (ts = base + i*ms, i in [0,n))
		since   int // since = base + since*ms
	}{
		{"no-wrap", 64, 20, 7},
		{"wrap", 8, 20, 14}, // ring holds last 8 (i=12..19); since trims to i>=14
		{"since-after-all", 64, 10, 100},
		{"since-zero", 64, 10, -1}, // -1 sentinel ⇒ zero time
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := &auditRing{buf: make([]AuditEntry, tc.ringCap)}
			for i := range tc.n {
				r.append(AuditEntry{
					Timestamp: base.Add(time.Duration(i) * time.Millisecond),
					Event:     "x",
					Fields:    map[string]any{"i": i},
				})
			}
			var since time.Time
			if tc.since >= 0 {
				since = base.Add(time.Duration(tc.since) * time.Millisecond)
			}
			// Compute the expected set: of the entries still RETAINED in
			// the ring (the last min(n, ringCap)), those with ts >= since.
			retainedFrom := 0
			if tc.n > tc.ringCap {
				retainedFrom = tc.n - tc.ringCap
			}
			var want []int
			for i := retainedFrom; i < tc.n; i++ {
				if since.IsZero() || !base.Add(time.Duration(i)*time.Millisecond).Before(since) {
					want = append(want, i)
				}
			}

			got := r.snapshot(since)
			if cap(got) != len(got) {
				t.Fatalf("snapshot cap=%d len=%d: result must be sized to match count, not whole ring", cap(got), len(got))
			}
			if len(got) != len(want) {
				t.Fatalf("snapshot len=%d, want %d (entries %v)", len(got), len(want), want)
			}
			for k, e := range got {
				if e.Fields["i"] != want[k] {
					t.Fatalf("got[%d].i = %v, want %d", k, e.Fields["i"], want[k])
				}
				if k > 0 && e.Timestamp.Before(got[k-1].Timestamp) {
					t.Fatalf("snapshot not in chronological order at index %d", k)
				}
			}
		})
	}
}

// TestAuditRing_SnapshotSinceUnderConcurrentAppend pins the
// PERF-2026-05-11-06 (#142) safety property: snapshot(since) under
// concurrent appends never deadlocks, never races (run with -race),
// returns a result slice sized to the match count (not to the whole
// ring), and every returned entry passes the per-entry `since` filter.
func TestAuditRing_SnapshotSinceUnderConcurrentAppend(t *testing.T) {
	r := &auditRing{buf: make([]AuditEntry, 4096)}
	base := time.Date(2026, 5, 11, 9, 0, 0, 0, time.UTC)
	const prefill = 200
	for i := range prefill {
		r.append(AuditEntry{
			Timestamp: base.Add(time.Duration(i) * time.Millisecond),
			Event:     "x",
			Fields:    map[string]any{"i": i},
		})
	}
	since := base.Add(time.Duration(prefill/2) * time.Millisecond)

	var wg sync.WaitGroup
	stop := make(chan struct{})
	for w := range 8 {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for j := range 100 {
				select {
				case <-stop:
					return
				default:
				}
				// All appended timestamps are at or after `since` so they
				// must all pass the filter.
				r.append(AuditEntry{
					Timestamp: base.Add(time.Duration(prefill+j) * time.Millisecond),
					Event:     "x",
					Fields:    map[string]any{"w": w, "j": j},
				})
			}
		}(w)
	}
	for range 300 {
		got := r.snapshot(since)
		if cap(got) != len(got) {
			t.Fatalf("snapshot cap=%d len=%d: result must be sized to match count, not whole ring", cap(got), len(got))
		}
		for _, e := range got {
			if e.Timestamp.Before(since) {
				t.Fatalf("snapshot returned entry %v before since %v", e.Timestamp, since)
			}
		}
	}
	close(stop)
	wg.Wait()

	// since trims the first prefill/2 entries, so snapshot(since) must be
	// strictly smaller than snapshot(zero).
	all := r.snapshot(time.Time{})
	half := r.snapshot(since)
	if len(half) >= len(all) {
		t.Fatalf("snapshot(since) len=%d should be < snapshot(zero) len=%d", len(half), len(all))
	}
}

// BenchmarkAuditRing_ConcurrentAppendSnapshot measures append-side
// contention while a background goroutine snapshots the (near-full)
// ring in a tight loop — the production shape: hot emitAudit appends vs
// a /api/v1/audit poll. Reports allocs/op so the right-sized snapshot
// allocation (PERF-2026-05-11-06, #142) shows up as reduced churn.
func BenchmarkAuditRing_ConcurrentAppendSnapshot(b *testing.B) {
	r := newAuditRing()
	// Pre-fill so snapshot copies a realistic, near-full ring.
	now := time.Now()
	for i := range auditBufferCap {
		r.append(AuditEntry{
			Timestamp: now.Add(time.Duration(i) * time.Microsecond),
			Event:     "query_executed",
			Fields:    map[string]any{"user": "alice", "rows": i},
		})
	}
	// `since` that trims to roughly the most-recent ~1% of the ring,
	// mirroring a 5s poll against a ring that fills slower than that.
	since := now.Add(time.Duration(auditBufferCap-auditBufferCap/100) * time.Microsecond)

	stop := make(chan struct{})
	var snapWG sync.WaitGroup
	snapWG.Add(1)
	go func() {
		defer snapWG.Done()
		for {
			select {
			case <-stop:
				return
			default:
				_ = r.snapshot(since)
			}
		}
	}()

	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		e := AuditEntry{Event: "login_success", Fields: map[string]any{"user": "bob"}}
		for pb.Next() {
			e.Timestamp = time.Now()
			r.append(e)
		}
	})
	b.StopTimer()
	close(stop)
	snapWG.Wait()
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
		// SECURITY_GAP_ANALYSIS C3: profile-store columns must be
		// redacted defensively even if a future call site forgets
		// to strip them before passing into emitAudit.
		{"dsn", true},
		{"DSN", true},
		{"tls_ca_pem", true},
		{"tls_cert_pem", true},
		{"tls_key_pem", true},
		{"ca_pem", true},
		{"cert_pem", true},
		{"key_pem", true},
		{"client_pem", true},
		{"connection_dsn", true},
		// SEC-F6+N6 closure: confirm the expanded geode-ui-specific
		// sensitive-key list. Each of these MUST redact even though
		// the obsx default list does not include the full local name.
		{"saved_password", true},
		{"tls_client_cert_pem", true},
		{"tls_client_cert_path", true},
		{"tls_client_key_pem", true},
		{"tls_client_key_path", true},
		{"tls_client_pem", true},
		{"tls_server_cert_pem", true},
		{"tls_server_key_pem", true},
		{"tls_password", true},
		{"url", true},
		{"connection_string", true},
		{"refresh_token", true},
		{"access_token", true},
		{"session_id", true},
		// Plain "profile" stays non-sensitive; we don't want to
		// over-redact metadata keys that document the audit subject.
		{"profile_id", false},
	}
	for _, c := range cases {
		if got := isSensitive(c.key); got != c.want {
			t.Errorf("isSensitive(%q) = %v, want %v", c.key, got, c.want)
		}
	}
}

// TestEmitAudit_RedactsProfileStoreSecrets verifies that even if a
// caller passes a DSN, PEM fragment, or other persistence-layer secret
// to emitAudit, the value never reaches slog or the in-memory ring.
// This is defense-in-depth backing SECURITY_GAP_ANALYSIS S5/S6: the
// profile CRUD audit events should not log secrets, but if a later
// refactor accidentally adds one to the kv list, redaction kicks in.
func TestEmitAudit_RedactsProfileStoreSecrets(t *testing.T) {
	t.Cleanup(resetAuditRing())
	// Use placeholder strings rather than real PEM headers so the
	// detect-private-key pre-commit hook does not flag this test
	// file. The redaction logic only inspects the *key* substring;
	// the value content is irrelevant.
	emitAudit("profile_updated",
		"actor", "alice",
		"profile_id", "p123",
		"dsn", "quic://prod-host:1234?password=hunter2",
		"tls_ca_pem", "ca-pem-placeholder",
		"tls_cert_pem", "cert-pem-placeholder",
		"tls_key_pem", "key-pem-placeholder",
		"ca_pem", "ca-bundle",
		"cert_pem", "cert-bundle",
		"key_pem", "key-bundle",
	)
	got := defaultAuditRing.snapshot(time.Time{})
	if len(got) != 1 {
		t.Fatalf("snapshot len = %d, want 1", len(got))
	}
	f := got[0].Fields
	if f["actor"] != "alice" {
		t.Errorf("actor not preserved: %v", f["actor"])
	}
	if f["profile_id"] != "p123" {
		t.Errorf("profile_id not preserved: %v", f["profile_id"])
	}
	for _, k := range []string{"dsn", "tls_ca_pem", "tls_cert_pem", "tls_key_pem", "ca_pem", "cert_pem", "key_pem"} {
		if f[k] != "[REDACTED]" {
			t.Errorf("key %q not redacted: %v", k, f[k])
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

// panicHandler is an slog handler that panics on every Handle call
// while its `armed` pointer is non-zero. The atomic flag lets the
// test arm-and-disarm the panic without leaving a poison handler in
// place — even if t.Cleanup somehow ran out of order, a disarmed
// instance just no-ops. Used by TestEmitAudit_LogContinuePolicy.
type panicHandler struct {
	armed *atomic.Bool
}

func (h panicHandler) Enabled(_ context.Context, _ slog.Level) bool { return true }
func (h panicHandler) Handle(_ context.Context, _ slog.Record) error {
	if h.armed != nil && h.armed.Load() {
		panic("simulated audit sink failure")
	}
	return nil
}
func (h panicHandler) WithAttrs(_ []slog.Attr) slog.Handler { return h }
func (h panicHandler) WithGroup(_ string) slog.Handler      { return h }

// TestEmitAudit_LogContinuePolicy pins GAP-Q7's policy: emitAudit is
// best-effort log+continue. A panicking slog handler MUST NOT escape
// emitAudit — the caller (an HTTP handler returning a 2xx) must keep
// running. The recovery path writes a one-line stderr warning so
// observability is not silently lost.
func TestEmitAudit_LogContinuePolicy(t *testing.T) {
	armed := &atomic.Bool{}
	armed.Store(true)
	prev := slog.Default()
	slog.SetDefault(slog.New(panicHandler{armed: armed}))
	t.Cleanup(func() {
		armed.Store(false) // disarm first so any in-flight goroutine sees no-op
		slog.SetDefault(prev)
	})

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("emitAudit propagated panic %v; Q7 policy violated", r)
		}
	}()
	// Calling emitAudit must not panic even when slog.Info panics.
	emitAudit("user_created", "user", "alice", "target", "bob")
}
