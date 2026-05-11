package server

import (
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"geodedb.com/geode-ui/gen/pkg/obsx"
)

// Audit-log surface mirrors ~/src/devnw/go/oidc/audit.go: single-line
// key=value records emitted via slog with sensitive-key redaction, plus
// an in-memory ring buffer that backs the GET /api/v1/audit query
// endpoint. The buffer is intentionally small and process-local — it is
// a read-back convenience for operators using the UI, not a
// persistent audit destination.
//
// Out of scope: durable storage, JSON Lines export, hash-chained
// sequencing, retention/rotation policy. A dedicated round will land
// those once Phase D wires the UI viewer (D5).

// Audit event identifiers. Keeping these as constants so a typo at a
// call site fails compilation rather than silently breaking
// downstream log-shipping pattern matches.
const (
	auditEventLoginSuccess       = "login_success"
	auditEventLoginFailure       = "login_failure"
	auditEventQueryExecuted      = "query_executed"
	auditEventTxBegun            = "tx_begun"
	auditEventTxCommitted        = "tx_committed"
	auditEventTxRollback         = "tx_rollback"
	auditEventUserCreated        = "user_created"
	auditEventUserDeleted        = "user_deleted"
	auditEventUserDisabled       = "user_disabled"
	auditEventUserEnabled        = "user_enabled"
	auditEventUserPasswordSet    = "user_password_set"
	auditEventRoleAssigned       = "role_assigned"
	auditEventRoleCreated        = "role_created"
	auditEventRoleDeleted        = "role_deleted"
	auditEventPolicyCreated      = "policy_created"
	auditEventPolicyDeleted      = "policy_deleted"
	auditEventGrantApplied       = "grant_applied"
	auditEventGrantRevoked       = "grant_revoked"
	auditEventBackupCreated      = "backup_created"
	auditEventBackupDeleted      = "backup_deleted"
	auditEventBackupRestored     = "backup_restored"
	auditEventBackupCleanup      = "backup_cleanup"
	auditEventMigrationRun       = "migration_run"
	auditEventMigrationCreated   = "migration_created"
	auditEventMigrationSigned    = "migration_signed"
	auditEventProfileCreated     = "profile_created"
	auditEventProfileUpdated     = "profile_updated"
	auditEventProfileDeleted     = "profile_deleted"
	auditEventProfileReloadFail  = "profile_reload_failed"
	auditEventProfileRateLimited = "profile_rate_limited"
)

// sensitiveKeys are case-insensitive substrings that, when found in an
// audit field's key name, force the value to be redacted. We extend the
// centralised obsx.DefaultSensitiveKeyFragments list (which already covers
// generic credential fragments like password/jwt/bearer/token/etc) with
// geode-ui-specific keys that surface in profile and connection records:
// saved_password (the on-disk password column), tls_client_* fields
// emitted by the profile editor, and the raw `dsn` style "url" key the
// connection form uses interchangeably with `dsn`. Keep both the central
// list and these locals together so a single isSensitive() call covers
// the full surface. False positives (over-redaction) are far cheaper
// than false negatives (leaking a secret to the audit channel).
var sensitiveKeys = append(append([]string{}, obsx.DefaultSensitiveKeyFragments...),
	// geode-ui-specific additions on top of obsx defaults.
	"saved_password",    // profilestore on-disk password field
	"tls_ca_pem",        // already covered by ca_pem, kept for grep affinity
	"tls_client_cert",   // any tls_client_cert_pem / tls_client_cert_path
	"tls_client_key",    // any tls_client_key_pem / tls_client_key_path
	"tls_client_pem",    // legacy single-cert+key bundle
	"tls_server_cert",   // server cert path / pem
	"tls_server_key",    // server key path / pem
	"tls_password",      // private-key passphrase
	"url",               // connection forms sometimes use "url" for full DSN
	"connection_string", // alt naming used by Snowflake/SQL Server adapters
	"session_id",        // opaque session handles MAY include creds in some backends
	"refresh_token",     // already covered by token, kept explicit
	"access_token",      // already covered by token, kept explicit
)

// AuditEntry is one record retained in the in-memory ring buffer for
// the /api/v1/audit endpoint. Event is the identifier from the
// auditEvent* constants above; Fields is a flat key/value map after
// redaction.
type AuditEntry struct {
	Timestamp time.Time      `json:"timestamp"`
	Event     string         `json:"event"`
	Fields    map[string]any `json:"fields"`
}

// auditBufferCap caps the in-memory ring buffer at 10k entries. At ~256
// bytes per entry that is roughly 2.5 MiB resident — a comfortable
// budget for a process-local debug aid. Older entries are dropped FIFO.
const auditBufferCap = 10_000

// auditRing is a fixed-capacity FIFO ring buffer of AuditEntry. Concurrent
// callers append from request handlers; the /api/v1/audit endpoint reads
// a snapshot. The mutex is the simplest safe approach — append is O(1)
// and snapshot is O(n) over the whole buffer; n is bounded by
// auditBufferCap so this never grows unbounded.
type auditRing struct {
	mu    sync.Mutex
	buf   []AuditEntry
	start int // logical start index in buf (writes wrap)
	count int // current entries
}

// newAuditRing returns an empty ring with the buffer pre-allocated.
func newAuditRing() *auditRing {
	return &auditRing{buf: make([]AuditEntry, auditBufferCap)}
}

// append adds one entry at the end of the ring. When the buffer is full
// the oldest entry is overwritten.
func (r *auditRing) append(entry AuditEntry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	idx := (r.start + r.count) % len(r.buf)
	r.buf[idx] = entry
	if r.count < len(r.buf) {
		r.count++
		return
	}
	r.start = (r.start + 1) % len(r.buf)
}

// snapshot returns entries with Timestamp >= since, in chronological
// order. A zero `since` returns every retained entry. The returned
// slice is safely owned by the caller — the ring's underlying buffer
// is not shared.
func (r *auditRing) snapshot(since time.Time) []AuditEntry {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]AuditEntry, 0, r.count)
	for i := 0; i < r.count; i++ {
		idx := (r.start + i) % len(r.buf)
		e := r.buf[idx]
		if since.IsZero() || !e.Timestamp.Before(since) {
			out = append(out, e)
		}
	}
	return out
}

// defaultAuditRing is the package-level ring written by emitAudit and
// read by the /api/v1/audit handler. A single shared ring keeps the
// emit call sites honest — every handler can fire and forget, and the
// HTTP handler reads from the same buffer regardless of which goroutine
// recorded the event.
var defaultAuditRing = newAuditRing()

// emitAudit writes one record to slog at INFO level (prefixed with
// "AUDIT") AND appends to the in-memory ring. kv is a flat
// key, value, key, value, ... slice — same shape as slog accepts.
//
// Keys whose lower-cased name contains a substring from sensitiveKeys
// are redacted to "[REDACTED]" before either destination sees them.
// Callers should still avoid passing sensitive material in the first
// place; redaction is a defensive safety net.
//
// Emission policy (GAP-Q7 / #37): audit emission is **best-effort,
// log+continue**. A failure here MUST NOT break the wrapping handler
// — auditing is observability, not security gating. The wrapping
// `defer recover()` enforces that policy: if a custom slog handler
// or the ring buffer panics (bad writer, OOM, etc.), the panic is
// caught, surfaced as a one-line stderr warning, and the handler
// proceeds. Callers therefore correctly invoke this as
// `emitAudit(...)` with no error return — the policy is sealed in
// the helper rather than duplicated at every call site.
//
// (slog.Info does not return an error today and ringBuffer.append is
// infallible, so the panic guard is the only failure mode left to
// neutralise. The recovery path writes directly to os.Stderr because
// log.Default() in Go 1.21+ routes through slog and would re-panic
// on the same broken handler.)
func emitAudit(event string, kv ...any) {
	defer func() {
		// log+continue: catch any panic from the slog handler chain
		// or the ring buffer so a misbehaving sink can never escalate
		// into a 500 from the wrapping HTTP handler. We write
		// **directly** to os.Stderr rather than re-entering slog or
		// the standard `log` package — Go 1.21+ rewires log.Default()
		// to write through slog, so a panicking slog handler would
		// re-panic on the recovery path and propagate out anyway.
		// fmt.Fprintf to os.Stderr is the only sink guaranteed to
		// stay independent of the audit pipeline.
		if rec := recover(); rec != nil {
			fmt.Fprintf(os.Stderr,
				"AUDIT EMISSION FAILED event=%s panic=%v\n", event, rec)
		}
	}()
	args := make([]any, 0, len(kv)+2)
	args = append(args, "event", event)
	fields := make(map[string]any, len(kv)/2)
	for i := 0; i+1 < len(kv); i += 2 {
		key, _ := kv[i].(string)
		val := kv[i+1]
		if isSensitive(key) {
			val = "[REDACTED]"
		}
		args = append(args, key, val)
		if key != "" {
			fields[key] = val
		}
	}
	slog.Info("AUDIT", args...)
	defaultAuditRing.append(AuditEntry{
		Timestamp: time.Now().UTC(),
		Event:     event,
		Fields:    fields,
	})
}

// isSensitive reports whether key (case-insensitive) contains any
// fragment from sensitiveKeys. This is a thin wrapper around
// obsx.IsSensitiveKey so call sites in this package read clearly while
// the actual substring-match implementation lives next to the canonical
// redaction helper in obsx (SEC-F6+N6: centralised redaction).
func isSensitive(key string) bool {
	return obsx.IsSensitiveKey(key, sensitiveKeys)
}
