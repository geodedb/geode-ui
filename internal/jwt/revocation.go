package jwt

import (
	"context"
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
// IMPORTANT — in-memory caveat: a process restart resets both maps, so a
// token revoked before the restart validates again afterward (until its
// natural TTL expiry). Given the short JWT TTL (1m..24h, 8h default) the
// residual exposure window is bounded. A durable revocation store (e.g.
// a row in the SQLite profile store, or Redis) would close this; that is
// out of scope for the in-memory decision recorded for SEC-N2.
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

	// nowFn is overridable in tests; defaults to time.Now.
	nowFn func() time.Time
}

// NewRevocationSet returns an empty RevocationSet.
func NewRevocationSet() *RevocationSet {
	return &RevocationSet{nowFn: time.Now}
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
			return
		}
		if prevT, ok := prev.(time.Time); ok && !now.After(prevT) {
			// An existing entry is already at or ahead of `now`; nothing
			// to do (clock skew or a rapid double-change).
			return
		}
		if rs.passwordChangedAt.CompareAndSwap(username, prev, now) {
			return
		}
		// Lost a race; retry with the latest value.
	}
}

// IsRevoked reports whether the supplied claims correspond to a token
// that has been revoked, by either mechanism. A nil RevocationSet or nil
// claims is treated as "not revoked".
func (rs *RevocationSet) IsRevoked(c *Claims) bool {
	if rs == nil || c == nil {
		return false
	}
	// Per-token revocation by jti.
	if c.ID != "" {
		if v, ok := rs.revoked.Load(c.ID); ok {
			if exp, ok := v.(time.Time); ok {
				if rs.now().Before(exp) {
					return true
				}
				// Expired revocation entry — the token's own TTL guard
				// already rejects it, so drop the stale entry and fall
				// through.
				rs.revoked.Delete(c.ID)
			} else {
				// Defensive: a non-time value should never be stored,
				// but if it somehow is, treat the token as revoked
				// rather than silently letting it through.
				return true
			}
		}
	}
	// Per-user revoke-all by passwordChangedAt.
	if c.Subject != "" && c.IssuedAt != nil {
		if v, ok := rs.passwordChangedAt.Load(c.Subject); ok {
			if changedAt, ok := v.(time.Time); ok {
				// iat at or before the change instant ⇒ stale token.
				if !c.IssuedAt.After(changedAt) {
					return true
				}
			}
		}
	}
	return false
}

// Sweep drops jti entries whose expiry has passed and passwordChangedAt
// entries older than maxTokenAge (which should be ≥ the maximum JWT TTL,
// so no still-valid token can reference a swept instant). Call it
// periodically — e.g. from StartSweeper — to keep the maps bounded.
func (rs *RevocationSet) Sweep(maxTokenAge time.Duration) {
	now := rs.now()
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

// StartSweeper runs Sweep on a ticker until ctx is cancelled. interval
// is the sweep cadence; maxTokenAge is forwarded to Sweep (pass the
// issuer's TTL ceiling — 24h is a safe over-estimate). It returns
// immediately; the loop runs in a goroutine.
func (rs *RevocationSet) StartSweeper(ctx context.Context, interval, maxTokenAge time.Duration) {
	if interval <= 0 {
		interval = 10 * time.Minute
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
