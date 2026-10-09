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
	// Declared last on purpose: struct field order fixes the JSON key
	// order of every issued token payload, so moving the embed to the
	// top would change minted token bytes.
	jjwt.RegisteredClaims //nolint:embeddedstructfieldcheck // field order = JWT payload key order.
}

// Issuer signs and verifies HS256 tokens. It is safe for concurrent use:
// the underlying jjwt library reads-only the secret slice on each call,
// and the revocation set is internally synchronized.
type Issuer struct {
	secret  []byte
	ttl     time.Duration
	revoked *RevocationSet
}

// minSecretBytes is the minimum HMAC secret length NewIssuer accepts
// (256 bits, matching the HS256 output size).
const minSecretBytes = 32

// NewIssuer constructs an Issuer. The secret must be at least 32 bytes
// (HS256 keys shorter than the hash output size weaken signature
// strength) and the ttl must lie between one minute and 24 hours —
// shorter ttls force chatty re-login flows, longer ttls leave bad
// tokens valid past any reasonable revocation window. The Issuer is
// created with a fresh in-process RevocationSet (SEC-N2 / #64),
// reachable via Revocation().
func NewIssuer(secret []byte, ttl time.Duration) (*Issuer, error) {
	if len(secret) < minSecretBytes {
		return nil, errors.New("jwt: secret must be at least 32 bytes")
	}
	if ttl < time.Minute || ttl > 24*time.Hour {
		return nil, errors.New("jwt: ttl must be 1m..24h")
	}
	return &Issuer{secret: secret, ttl: ttl, revoked: NewRevocationSet()}, nil
}

// TTL reports the configured token lifetime. Useful as the maxTokenAge
// argument to RevocationSet.Sweep / StartSweeper.
func (i *Issuer) TTL() time.Duration { return i.ttl }

// Revocation returns the Issuer's in-process revocation set so callers
// (e.g. the password-change handler) can revoke individual tokens or
// all of a user's tokens. Never nil for an Issuer built via NewIssuer.
func (i *Issuer) Revocation() *RevocationSet { return i.revoked }

// Issue mints a new HS256-signed token. connID identifies a single
// authenticated connection so multi-session SPAs can hold multiple
// tokens at once and the server can disambiguate them in audit logs.
// Pass "" to omit the cid claim (legacy single-session callers).
//
// Every token carries a fresh crypto/rand jti (RFC 7519 "ID" claim,
// 128 bits, hex-encoded) so it can be individually revoked via
// Revocation().Revoke (SEC-N2 / #64).
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
	signed, err := tok.SignedString(i.secret)
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
		return i.secret, nil
	}, jjwt.WithLeeway(clockLeeway))
	if err != nil {
		return nil, err
	}
	if i.revoked.IsRevoked(c) {
		return nil, ErrRevoked
	}
	return c, nil
}
