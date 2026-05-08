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
	"errors"
	"time"

	jjwt "github.com/golang-jwt/jwt/v5"
)

// Claims is the payload encoded into every token issued by this
// package. It embeds jjwt.RegisteredClaims so iat/exp/sub from RFC 7519
// are included and validated for free by the underlying library.
type Claims struct {
	Subject string   `json:"sub"`
	Profile string   `json:"profile"`
	Roles   []string `json:"roles"`
	jjwt.RegisteredClaims
}

// Issuer signs and verifies HS256 tokens. It is safe for concurrent use:
// the underlying jjwt library reads-only the secret slice on each call.
type Issuer struct {
	secret []byte
	ttl    time.Duration
}

// NewIssuer constructs an Issuer. The secret must be at least 32 bytes
// (HS256 keys shorter than the hash output size weaken signature
// strength) and the ttl must lie between one minute and 24 hours —
// shorter ttls force chatty re-login flows, longer ttls leave bad
// tokens valid past any reasonable revocation window.
func NewIssuer(secret []byte, ttl time.Duration) (*Issuer, error) {
	if len(secret) < 32 {
		return nil, errors.New("jwt: secret must be at least 32 bytes")
	}
	if ttl < time.Minute || ttl > 24*time.Hour {
		return nil, errors.New("jwt: ttl must be 1m..24h")
	}
	return &Issuer{secret: secret, ttl: ttl}, nil
}

// Issue mints a new HS256-signed token with the given subject, profile,
// and roles. It returns the encoded token, the absolute expiry time,
// and any signing error.
func (i *Issuer) Issue(sub, profile string, roles []string) (string, time.Time, error) {
	now := time.Now()
	exp := now.Add(i.ttl)
	tok := jjwt.NewWithClaims(jjwt.SigningMethodHS256, Claims{
		Subject: sub,
		Profile: profile,
		Roles:   roles,
		RegisteredClaims: jjwt.RegisteredClaims{
			IssuedAt:  jjwt.NewNumericDate(now),
			ExpiresAt: jjwt.NewNumericDate(exp),
			Subject:   sub,
		},
	})
	signed, err := tok.SignedString(i.secret)
	return signed, exp, err
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
	return c, nil
}
