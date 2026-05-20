// Package jwt issues and verifies HS256-signed JWTs that gate the Geode
// UI HTTP API and WebSocket surfaces.
//
// The token shape is intentionally minimal: a Subject (the upstream Geode
// username), a Profile (the connection-profile name selected at login
// time), and a Roles slice (the role names returned by `SHOW USER ROLES`
// against the upstream Geode at login). The roles claim is what
// genapi's required_roles enforcement reads to allow / reject admin
// routes.
//
// We intentionally use HS256 with a single shared secret rather than a
// JWKS / RS256 setup: the Geode UI server is the only issuer AND the
// only verifier of these tokens, so an asymmetric key adds operational
// burden without solving any threat in this deployment model. The
// secret is supplied via -jwt-secret-hex on the command line and must
// be at least 32 bytes (256 bits) of entropy — see NewIssuer.
package jwt

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	jjwt "github.com/golang-jwt/jwt/v5"
)

// ErrRevoked is returned by Parse when the token's signature and
// standard claims are valid but the token has been revoked — either
// individually (by jti) or as part of a per-user revoke-all (password
// change). It is a distinct sentinel so callers can tell "revoked" from
// "malformed / expired" if they want to surface a friendlier message;
// the generated auth wrapper treats any non-nil Parse error as 401.
var ErrRevoked = errors.New("jwt: token revoked")

// jtiBytes is the number of crypto/rand bytes packed into each token's
// jti (the RFC 7519 "ID" claim). 16 bytes = 128 bits — collision-
// resistant for any realistic token-issuance rate, and enough entropy
// that a jti can't be guessed to pre-emptively poison the revocation
// set. Encoded as lowercase hex (32 chars) so the claim is a plain
// ASCII string with no base64 padding quirks.
const jtiBytes = 16

// newJTI returns a fresh hex-encoded 128-bit identifier from crypto/rand.
// A read failure from crypto/rand is treated as fatal-to-the-request
// (returned as an error) rather than silently falling back to a weaker
// source — a token without a unique jti can't be individually revoked.
func newJTI() (string, error) {
	b := make([]byte, jtiBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("jwt: jti entropy: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// Claims is the payload encoded into every token issued by this
// package. It embeds jjwt.RegisteredClaims so iat/exp/sub from RFC 7519
// are included and validated for free by the underlying library.
type Claims struct {
	Subject      string   `json:"sub"`
	Profile      string   `json:"profile"`
	Roles        []string `json:"roles"`
	ConnectionID string   `json:"cid,omitempty"`
	jjwt.RegisteredClaims
}

// DefaultKID is the kid header stamped on every token issued by an
// Issuer constructed via NewIssuer (legacy single-secret path).
// Operators that opt into key rotation via NewIssuerWithKeys should
// supply explicit kids and SHOULD NOT use this value to avoid
// silently overlapping with legacy tokens during a rotation window.
const DefaultKID = "current"

// PreviousKID is the conventional kid suggested in the operator
// runbook for the previous secret during a rotation window. Tokens
// issued before the rotation continue to verify because the Issuer
// still has the previous secret indexed under this kid.
const PreviousKID = "previous"

// Issuer signs and verifies HS256 tokens. It is safe for concurrent use:
// the underlying jjwt library reads-only the secret slice on each call,
// and the revocation set is internally synchronized.
//
// SEC-NEW-7 (#210): Issuer supports key rotation via a kid-keyed
// secret map. The active kid is stamped into every issued token's
// header (`{"alg":"HS256","kid":"<active>"}`), and Parse uses the
// inbound token's `kid` to pick the verification key — so a stale
// token signed with the previous secret continues to verify until
// its `exp` while a fresh token is signed with the new secret. The
// legacy single-secret constructor remains as a thin wrapper.
type Issuer struct {
	// keys is the kid → secret map. Always contains at least
	// activeKID's entry. For the legacy NewIssuer path it has one
	// entry keyed on DefaultKID.
	keys map[string][]byte
	// activeKID is the kid stamped on every newly-issued token.
	activeKID string
	ttl       time.Duration
	revoked   *RevocationSet
}

// NewIssuer constructs an Issuer with a single secret. This is the
// legacy path; use NewIssuerWithKeys for operators rotating keys.
// The secret must be at least 32 bytes (HS256 keys shorter than the
// hash output size weaken signature strength) and the ttl must lie
// between one minute and 24 hours — shorter ttls force chatty
// re-login flows, longer ttls leave bad tokens valid past any
// reasonable revocation window. The Issuer is created with a fresh
// in-process RevocationSet (SEC-N2 / #64), reachable via Revocation().
//
// SEC-NEW-7 (#210): tokens are stamped with kid="current". This is
// backward-compatible — a deployment that has never rotated still
// verifies every token by the same single secret it issued under.
func NewIssuer(secret []byte, ttl time.Duration) (*Issuer, error) {
	return NewIssuerWithKeys(map[string][]byte{DefaultKID: secret}, DefaultKID, ttl)
}

// NewIssuerWithKeys constructs an Issuer that signs new tokens with
// keys[activeKID] but still verifies inbound tokens signed under any
// kid present in keys. This is the SEC-NEW-7 rotation primitive:
//
//	keys      = {"current": newSecret, "previous": oldSecret}
//	activeKID = "current"
//
// All four invariants are checked at construction time:
//   - keys must be non-empty
//   - every secret must be at least 32 bytes
//   - activeKID must be present in keys
//   - ttl must lie in [1m, 24h] (same as NewIssuer)
//
// The kid space is open — operators can pick any string identifier
// they want (timestamp, version tag, etc.) as long as it round-trips
// through JSON. The conventional choice ("current"/"previous") is
// documented in the operator runbook.
func NewIssuerWithKeys(keys map[string][]byte, activeKID string, ttl time.Duration) (*Issuer, error) {
	if len(keys) == 0 {
		return nil, errors.New("jwt: keys map must be non-empty")
	}
	if _, ok := keys[activeKID]; !ok {
		return nil, fmt.Errorf("jwt: activeKID %q not present in keys map", activeKID)
	}
	for kid, secret := range keys {
		if len(secret) < 32 {
			return nil, fmt.Errorf("jwt: secret for kid %q must be at least 32 bytes", kid)
		}
	}
	if ttl < time.Minute || ttl > 24*time.Hour {
		return nil, errors.New("jwt: ttl must be 1m..24h")
	}
	// Defensive copy so the caller can drop their reference after.
	copied := make(map[string][]byte, len(keys))
	for k, v := range keys {
		secCopy := make([]byte, len(v))
		copy(secCopy, v)
		copied[k] = secCopy
	}
	return &Issuer{keys: copied, activeKID: activeKID, ttl: ttl, revoked: NewRevocationSet()}, nil
}

// ActiveKID reports the kid stamped on freshly-issued tokens. Useful
// for runbook output and integration tests.
func (i *Issuer) ActiveKID() string { return i.activeKID }

// KnownKIDs returns the sorted list of kids the Issuer can verify
// against. Useful for ops tooling that surfaces the rotation window
// to operators.
func (i *Issuer) KnownKIDs() []string {
	out := make([]string, 0, len(i.keys))
	for k := range i.keys {
		out = append(out, k)
	}
	// Sort for stable output.
	for a := 0; a < len(out); a++ {
		for b := a + 1; b < len(out); b++ {
			if out[a] > out[b] {
				out[a], out[b] = out[b], out[a]
			}
		}
	}
	return out
}

// TTL reports the configured token lifetime. Useful as the maxTokenAge
// argument to RevocationSet.Sweep / StartSweeper.
func (i *Issuer) TTL() time.Duration { return i.ttl }

// Revocation returns the Issuer's in-process revocation set so callers
// (e.g. the password-change handler) can revoke individual tokens or
// all of a user's tokens. Never nil for an Issuer built via NewIssuer.
func (i *Issuer) Revocation() *RevocationSet { return i.revoked }

// RotateAndRevokeAll swaps the active signing secret AND removes every
// other kid from the verification set, so any token issued before the
// rotation hard-fails verification on the next request. The atomic
// "rotate + mass-revoke" contract is what an operator typically wants
// when they suspect the prior secret was leaked.
//
// S-NEW-E (#313): Issuers historically supported additive kid rotation
// (NewIssuerWithKeys threads a {previous, current} map and Parse falls
// back to `activeKID`), which is the right behaviour for ZERO-downtime
// rotation under normal ops but is the wrong default during incident
// response — an operator running "rotate the JWT secret because of a
// suspected leak" reasonably expects every in-flight token to break,
// not just newly-issued ones. RotateAndRevokeAll makes that semantic
// explicit: a single call replaces the keys map with {newKID: secret},
// sets activeKID = newKID, and every token signed under any prior kid
// now hits the "unknown kid" hard-fail branch in Parse.
//
// Returns the previous activeKID so the caller can include it in audit
// output ("rotated 'previous' out, 'incident-2026-05-20' in").
func (i *Issuer) RotateAndRevokeAll(newKID string, secret []byte) (string, error) {
	if newKID == "" {
		return "", errors.New("jwt: new kid must be non-empty")
	}
	if len(secret) == 0 {
		return "", errors.New("jwt: new secret must be non-empty")
	}
	priorKID := i.activeKID
	i.keys = map[string][]byte{newKID: append([]byte(nil), secret...)}
	i.activeKID = newKID
	return priorKID, nil
}

// Issue mints a new HS256-signed token. connID identifies a single
// authenticated connection so multi-session SPAs can hold multiple
// tokens at once and the server can disambiguate them in audit logs.
// Pass "" to omit the cid claim (legacy single-session callers).
//
// Every token carries a fresh crypto/rand jti (RFC 7519 "ID" claim,
// 128 bits, hex-encoded) so it can be individually revoked via
// Revocation().Revoke (SEC-N2 / #64).
//
// SEC-NEW-7 (#210): the JWS header carries a `kid` claim naming the
// signing secret. Parse() consults this header to pick a verification
// key from the Issuer's keys map, so a deployment that rotates
// secrets keeps the previous secret indexed (under e.g. "previous")
// for one TTL window while new tokens flow under the active kid.
func (i *Issuer) Issue(sub, profile string, roles []string, connID string) (string, time.Time, error) {
	now := time.Now()
	exp := now.Add(i.ttl)
	jti, err := newJTI()
	if err != nil {
		return "", time.Time{}, err
	}
	tok := jjwt.NewWithClaims(jjwt.SigningMethodHS256, Claims{
		Subject:      sub,
		Profile:      profile,
		Roles:        roles,
		ConnectionID: connID,
		RegisteredClaims: jjwt.RegisteredClaims{
			ID:        jti,
			IssuedAt:  jjwt.NewNumericDate(now),
			ExpiresAt: jjwt.NewNumericDate(exp),
			Subject:   sub,
		},
	})
	// SEC-NEW-7 (#210): stamp the active kid into the JWS header so
	// Parse can pick the right verification key during a rotation
	// window. The header is signed alongside the payload so an
	// attacker can't rewrite the kid to point at a weaker key.
	tok.Header["kid"] = i.activeKID
	secret, ok := i.keys[i.activeKID]
	if !ok {
		return "", time.Time{}, fmt.Errorf("jwt: active kid %q not in keys", i.activeKID)
	}
	signed, err := tok.SignedString(secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, exp, nil
}

// clockLeeway tolerates small skew between the issuing host and the
// verifying host. Closes SEC-F3 (#70): without leeway, a request that
// arrives ~tens of seconds after issuance could fail iat / nbf checks
// when the two hosts' wall clocks drift, even though the token is
// otherwise valid. 60 s mirrors the default in OIDC libraries (e.g.
// node-oidc-provider, Spring Authorization Server) and is small
// enough that a stolen-but-expired token can't be replayed for a
// meaningful window.
const clockLeeway = 60 * time.Second

// Parse verifies the signature and standard claims of token, returning
// the decoded *Claims on success. The keyfunc rejects any algorithm
// other than HS256 — without this guard a token signed with the "none"
// algorithm or an asymmetric algorithm could otherwise be accepted.
//
// After signature + standard-claim validation, Parse also consults the
// Issuer's RevocationSet (SEC-N2 / #64): a token whose jti has been
// individually revoked, or whose iat predates a per-user revoke-all
// (password change), is rejected with ErrRevoked even though it is
// otherwise well-formed and unexpired.
func (i *Issuer) Parse(token string) (*Claims, error) {
	c := &Claims{}
	_, err := jjwt.ParseWithClaims(token, c, func(t *jjwt.Token) (any, error) {
		if t.Method.Alg() != jjwt.SigningMethodHS256.Alg() {
			return nil, errors.New("jwt: unexpected alg")
		}
		// SEC-NEW-7 (#210): pick the verification key from the kid
		// header. Tokens issued without a kid (legacy issuers that
		// pre-date this change) fall through to the activeKID's
		// secret — this preserves the contract for in-flight tokens
		// that pre-date a deploy. Unknown kids hard-fail (no
		// down-grade to a known secret) so an attacker can't pin a
		// kid that names a weaker / rotated-out key.
		kid, _ := t.Header["kid"].(string)
		if kid == "" {
			kid = i.activeKID
		}
		secret, ok := i.keys[kid]
		if !ok {
			return nil, fmt.Errorf("jwt: unknown kid %q", kid)
		}
		return secret, nil
	}, jjwt.WithLeeway(clockLeeway))
	if err != nil {
		return nil, err
	}
	if i.revoked.IsRevoked(c) {
		return nil, ErrRevoked
	}
	return c, nil
}
