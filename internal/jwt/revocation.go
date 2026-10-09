package jwt

import (
	"context"
	"database/sql"
	"log/slog"
	"sync"
	"time"
)

// RevocationSet is an in-process JWT revocation registry. It supports
// two independent mechanisms (SEC-N2 / #64):
//
//   - Per-token revocation by jti: Revoke(jti, exp) marks a single token
//     as no longer valid; IsRevoked rejects it until exp passes (after
//     which the natural TTL guard takes over and the entry is swept).
//
//   - Per-user "revoke everything" by passwordChangedAt: RevokeUser(sub)
//     records the wall-clock instant of (typically) a password change;
//     IsRevoked then rejects every token for that subject whose iat is
//     before that instant. This is the mechanism behind "changing a
//     password invalidates all of that user's sessions" — geode-ui has
//     no user-attribute store of its own (users live upstream in Geode
//     and are enumerated via SHOW USERS), so a per-user "token
//     generation" counter can't be persisted; the in-memory
//     passwordChangedAt map is the pragmatic equivalent.
//
// Durability (SEC-N2 follow-up): when AttachSQLite is called, the two
// sync.Maps become an in-memory READ-THROUGH CACHE over a SQLite table
// pair in the profile-store DB. SQLite is the durable source of truth;
// the cache is loaded from it at startup and kept in sync write-through
// on every Revoke/RevokeUser (SQLite first, then the cache). The hot
// path — IsRevoked — reads the cache ONLY and never issues a SQL query.
// A process restart re-hydrates the cache from SQLite, so a token
// revoked before the restart stays revoked afterward.
//
// When AttachSQLite has NOT been called (the default, e.g. unit tests
// that build a bare RevocationSet), the maps are simply the in-memory
// store with no durability — identical to the pre-N2-follow-up
// behaviour. The short JWT TTL (1m..24h, 8h default) bounds the residual
// exposure window in that mode.
//
// RevocationSet is safe for concurrent use.
type RevocationSet struct {
	// jti -> token expiry. An entry past its expiry is dead weight (the
	// TTL check in the underlying JWT library already rejects the token)
	// and is dropped by Sweep.
	revoked sync.Map // map[string]time.Time

	// username (JWT subject) -> instant after which tokens for that
	// subject are rejected if their iat predates it.
	passwordChangedAt sync.Map // map[string]time.Time

	// backend is the durable layer. nil ⇒ pure in-memory. When non-nil,
	// Revoke/RevokeUser write to it before updating the maps, Sweep
	// prunes it alongside the maps, and AttachSQLite hydrates the maps
	// from it at startup.
	backend *sqliteRevocationBackend

	// nowFn is overridable in tests; defaults to time.Now.
	nowFn func() time.Time
}

// NewRevocationSet returns an empty in-memory RevocationSet (no
// durability). Call AttachSQLite to back it with the profile-store DB.
func NewRevocationSet() *RevocationSet {
	return &RevocationSet{nowFn: time.Now}
}

// AttachSQLite makes this RevocationSet durable, backed by the supplied
// *sql.DB (intended to be the profile store's handle — a NEW table pair
// in the existing file, not a second DB). Both the read path (the
// startup hydration SELECTs) and the write path (migrations, putJTI,
// putUser, sweep) use the single handle. Equivalent to
// AttachSQLiteRW(db, db).
//
// Prefer AttachSQLiteRW when a separate read-only handle on the same
// file is available (see profilestore.DBHandleProvider) — that keeps
// revocation reloads from queueing behind in-flight profile-CRUD
// writes (PERF-2026-05-11-09 / #150).
//
// db must not be nil.
func (rs *RevocationSet) AttachSQLite(db *sql.DB) error {
	return rs.AttachSQLiteRW(db, db)
}

// AttachSQLiteRW makes this RevocationSet durable using TWO handles on
// the same SQLite file: rw (the single-writer handle — migrations and
// every write go through it so they serialise with profile CRUD) and ro
// (a read-only handle, mode=ro, used for the startup hydration SELECTs
// so a revocation reload never queues behind an in-flight profile-CRUD
// write). ro may equal rw (in-memory DSN) — then everything uses rw,
// identical to the pre-#150 behaviour. It:
//
//  1. runs CREATE TABLE IF NOT EXISTS migrations on rw,
//  2. SELECTs every still-relevant row (via ro) into the in-memory
//     cache (skipping already-expired jti rows),
//  3. DELETEs the stale revoked_jti rows (via rw) so the table stays
//     bounded.
//
// After this returns, the existing cache contents (if called on a
// RevocationSet that already had in-memory entries) are preserved AND
// the loaded rows are merged in — but the intended use is to call it on
// a fresh set during startup. Idempotent-ish: calling it twice re-runs
// the load (harmless) but replaces the backend, so don't.
//
// rw must not be nil; a nil ro is treated as "use rw for reads too".
// The caller (the profile store) owns both handles' lifecycles — the
// backend never closes either.
func (rs *RevocationSet) AttachSQLiteRW(rw, ro *sql.DB) error {
	be, err := newSQLiteRevocationBackend(rw, ro)
	if err != nil {
		return err
	}
	jtis, users, err := be.load(rs.now())
	if err != nil {
		return err
	}
	for jti, exp := range jtis {
		rs.revoked.Store(jti, exp)
	}
	for username, changedAt := range users {
		rs.passwordChangedAt.Store(username, changedAt)
	}
	rs.backend = be
	return nil
}

func (rs *RevocationSet) now() time.Time {
	if rs.nowFn != nil {
		return rs.nowFn()
	}
	return time.Now()
}

// Revoke marks the token identified by jti as revoked until exp. A blank
// jti is ignored (legacy tokens minted before SEC-N2 carry no jti and
// therefore cannot be individually revoked — they remain subject to the
// per-user mechanism and their natural TTL).
func (rs *RevocationSet) Revoke(jti string, exp time.Time) {
	if jti == "" {
		return
	}
	// Write-through: durable layer first so a crash between the two
	// stores leaves the *more* restrictive state (revoked-in-SQLite,
	// not-yet-in-cache rehydrates as revoked on next start). A SQLite
	// write failure is logged but not fatal — the in-memory revoke
	// still takes effect for the current process lifetime, which is no
	// worse than the pre-durability behaviour.
	if rs.backend != nil {
		if err := rs.backend.putJTI(jti, exp); err != nil {
			slog.Error("jwt: persist token revocation", "jti", jti, "err", err)
		}
	}
	rs.revoked.Store(jti, exp)
}

// RevokeUser invalidates every currently-valid token for the given
// subject (username) by recording "now" as that subject's
// password-changed instant. Any token whose iat is at or before this
// instant is rejected by IsRevoked. Tokens minted *after* the call
// (e.g. a fresh login with the new password) have a later iat and are
// unaffected. Calling RevokeUser again moves the instant forward
// monotonically.
func (rs *RevocationSet) RevokeUser(username string) {
	if username == "" {
		return
	}
	now := rs.now()
	for {
		prev, loaded := rs.passwordChangedAt.LoadOrStore(username, now)
		if !loaded {
			rs.persistUser(username, now)
			return
		}
		if prevT, ok := prev.(time.Time); ok && !now.After(prevT) {
			// An existing entry is already at or ahead of `now`; nothing
			// to do (clock skew or a rapid double-change). The durable
			// row is already at-or-ahead too, so don't touch it.
			return
		}
		if rs.passwordChangedAt.CompareAndSwap(username, prev, now) {
			rs.persistUser(username, now)
			return
		}
		// Lost a race; retry with the latest value.
	}
}

// persistUser write-throughs a password_changed_at row. now is always
// strictly newer than any previously-persisted instant for username
// (the caller only reaches here after winning the monotonic-advance
// check), so an INSERT OR REPLACE can never move the durable marker
// backward. A SQLite failure is logged, not fatal — the in-memory
// marker is already updated and takes effect for this process.
func (rs *RevocationSet) persistUser(username string, now time.Time) {
	if rs.backend == nil {
		return
	}
	if err := rs.backend.putUser(username, now); err != nil {
		slog.Error("jwt: persist user revocation", "user", username, "err", err)
	}
}

// IsRevoked reports whether the supplied claims correspond to a token
// that has been revoked, by either mechanism. A nil RevocationSet or nil
// claims is treated as "not revoked".
//
// Runs on every authenticated request, so the body is kept flat: the two
// revocation mechanisms are delegated to jtiRevoked / subjectRevokeAll,
// which preserve the exact lazy-GC, defensive, and comparison semantics
// of the original inline implementation.
func (rs *RevocationSet) IsRevoked(c *Claims) bool {
	if rs == nil || c == nil {
		return false
	}
	if c.ID != "" && rs.jtiRevoked(c.ID, rs.now()) {
		return true
	}
	if c.Subject != "" && c.IssuedAt != nil && rs.subjectRevokeAll(c.Subject, c.IssuedAt.Time) {
		return true
	}
	return false
}

// jtiRevoked reports whether the per-token revocation map names jti.
// Lazy GC: an entry whose time.Time expiry has already passed (relative
// to now) is deleted and reported as not-revoked — the token's own TTL
// guard already rejects it. Defensive: an entry whose value is somehow
// not a time.Time is treated as revoked rather than silently passing the
// token through.
func (rs *RevocationSet) jtiRevoked(jti string, now time.Time) bool {
	v, ok := rs.revoked.Load(jti)
	if !ok {
		return false
	}
	exp, ok := v.(time.Time)
	if !ok {
		// A non-time value should never be stored, but if it somehow
		// is, treat the token as revoked.
		return true
	}
	if now.Before(exp) {
		return true
	}
	// Expired revocation entry — drop the stale entry and treat as
	// not revoked.
	rs.revoked.Delete(jti)
	return false
}

// subjectRevokeAll reports whether the per-user revoke-all marker for sub
// invalidates a token issued at iat — i.e. iat is at or before the
// recorded password-change instant. A non-time stored value is ignored
// (treated as no marker), matching the original inline behavior.
func (rs *RevocationSet) subjectRevokeAll(sub string, iat time.Time) bool {
	v, ok := rs.passwordChangedAt.Load(sub)
	if !ok {
		return false
	}
	changedAt, ok := v.(time.Time)
	if !ok {
		return false
	}
	// iat at or before the change instant ⇒ stale token.
	return !iat.After(changedAt)
}

// Sweep drops jti entries whose expiry has passed and passwordChangedAt
// entries older than maxTokenAge (which should be ≥ the maximum JWT TTL,
// so no still-valid token can reference a swept instant). Call it
// periodically — e.g. from StartSweeper — to keep the maps bounded.
func (rs *RevocationSet) Sweep(maxTokenAge time.Duration) {
	now := rs.now()
	// Durable layer first (one or two DELETEs), then the cache. Order
	// doesn't matter for correctness here — both ends are converging on
	// "drop the stale rows" — but doing SQLite first keeps the pattern
	// consistent with the write-through path. A SQLite failure is
	// logged, not fatal: the cache prune below still bounds memory.
	if rs.backend != nil {
		if err := rs.backend.sweep(now, maxTokenAge); err != nil {
			slog.Error("jwt: sweep durable revocation store", "err", err)
		}
	}
	rs.revoked.Range(func(k, v any) bool {
		if exp, ok := v.(time.Time); ok && !now.Before(exp) {
			rs.revoked.Delete(k)
		}
		return true
	})
	if maxTokenAge > 0 {
		cutoff := now.Add(-maxTokenAge)
		rs.passwordChangedAt.Range(func(k, v any) bool {
			if changedAt, ok := v.(time.Time); ok && changedAt.Before(cutoff) {
				rs.passwordChangedAt.Delete(k)
			}
			return true
		})
	}
}

// defaultSweepInterval is the StartSweeper cadence used when the caller
// passes a non-positive interval.
const defaultSweepInterval = 10 * time.Minute

// StartSweeper runs Sweep on a ticker until ctx is cancelled. interval
// is the sweep cadence; maxTokenAge is forwarded to Sweep (pass the
// issuer's TTL ceiling — 24h is a safe over-estimate). It returns
// immediately; the loop runs in a goroutine.
func (rs *RevocationSet) StartSweeper(ctx context.Context, interval, maxTokenAge time.Duration) {
	if interval <= 0 {
		interval = defaultSweepInterval
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				rs.Sweep(maxTokenAge)
			}
		}
	}()
}
