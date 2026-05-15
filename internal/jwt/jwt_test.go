package jwt

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"strings"
	"testing"
	"time"

	jjwt "github.com/golang-jwt/jwt/v5"
)

func newSecret(t *testing.T) []byte {
	t.Helper()
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return b
}

// TestIssueAndParse exercises the round-trip: Issue then Parse should
// yield back the same subject / profile / roles, and the expiry must be
// in the future.
func TestIssueAndParse(t *testing.T) {
	iss, err := NewIssuer(newSecret(t), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	tok, exp, err := iss.Issue("alice", "default", []string{"admin", "reader"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if exp.Before(time.Now()) {
		t.Fatal("expired immediately")
	}
	c, err := iss.Parse(tok)
	if err != nil {
		t.Fatal(err)
	}
	if c.Subject != "alice" {
		t.Fatalf("sub=%q", c.Subject)
	}
	if c.Profile != "default" {
		t.Fatalf("profile=%q", c.Profile)
	}
	if len(c.Roles) != 2 || c.Roles[0] != "admin" || c.Roles[1] != "reader" {
		t.Fatalf("roles=%v", c.Roles)
	}
}

// TestNewIssuer_RejectsShortSecret pins the 32-byte minimum on the
// HS256 secret. A weaker secret (e.g. 16 bytes) is brute-forceable on
// commodity hardware in days.
func TestNewIssuer_RejectsShortSecret(t *testing.T) {
	_, err := NewIssuer(make([]byte, 16), time.Hour)
	if err == nil {
		t.Fatal("expected error for short secret")
	}
	if !strings.Contains(err.Error(), "32 bytes") {
		t.Fatalf("err=%v want mention of 32 bytes", err)
	}
}

// TestNewIssuer_RejectsTooShortTTL enforces the 1-minute lower bound on
// token lifetime. A 30-second token is essentially useless because it
// will expire mid-request on any non-trivial workload.
func TestNewIssuer_RejectsTooShortTTL(t *testing.T) {
	_, err := NewIssuer(newSecret(t), 30*time.Second)
	if err == nil {
		t.Fatal("expected error for too-short ttl")
	}
}

// TestNewIssuer_RejectsTooLongTTL enforces the 24-hour upper bound. A
// week-long token leaves a stolen credential valid for a week.
func TestNewIssuer_RejectsTooLongTTL(t *testing.T) {
	_, err := NewIssuer(newSecret(t), 48*time.Hour)
	if err == nil {
		t.Fatal("expected error for too-long ttl")
	}
}

// TestParse_RejectsTamperedToken flips a single byte in the payload and
// confirms the resulting signature mismatch surfaces as an error.
func TestParse_RejectsTamperedToken(t *testing.T) {
	iss, err := NewIssuer(newSecret(t), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	tok, _, err := iss.Issue("alice", "default", []string{"admin"}, "")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		t.Fatalf("unexpected token structure: %d segments", len(parts))
	}
	// Flip a character in the payload (middle segment). Using a known
	// base64-safe substitution keeps the segment decodable.
	tampered := tok[:len(parts[0])+1] + flipPayloadByte(parts[1]) + "." + parts[2]
	if _, err := iss.Parse(tampered); err == nil {
		t.Fatal("expected error parsing tampered token")
	}
}

// flipPayloadByte returns p with one base64-safe character substituted,
// guaranteeing the encoded JSON differs from the original.
func flipPayloadByte(p string) string {
	if len(p) == 0 {
		return p
	}
	r := []byte(p)
	if r[0] == 'a' {
		r[0] = 'b'
	} else {
		r[0] = 'a'
	}
	return string(r)
}

// TestParse_RejectsExpiredToken constructs a token with a backdated
// expiry and confirms Parse rejects it. We bypass the Issuer here so we
// can mint a token whose `exp` is already in the past — NewIssuer's TTL
// floor would otherwise prevent that.
func TestParse_RejectsExpiredToken(t *testing.T) {
	secret := newSecret(t)
	iss, err := NewIssuer(secret, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	tok := jjwt.NewWithClaims(jjwt.SigningMethodHS256, Claims{
		Subject: "alice",
		Profile: "default",
		Roles:   []string{"admin"},
		RegisteredClaims: jjwt.RegisteredClaims{
			IssuedAt:  jjwt.NewNumericDate(now.Add(-2 * time.Hour)),
			ExpiresAt: jjwt.NewNumericDate(now.Add(-time.Hour)),
			Subject:   "alice",
		},
	})
	signed, err := tok.SignedString(secret)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := iss.Parse(signed); err == nil {
		t.Fatal("expected error parsing expired token")
	}
}

// TestParse_RejectsWrongAlg ensures alg=RS256 tokens are rejected even
// if the embedded payload looks otherwise valid. Without this guard a
// malicious client could mint an RS256 token with a public key it
// chooses, then send it as if it were HS256-signed.
func TestParse_RejectsWrongAlg(t *testing.T) {
	iss, err := NewIssuer(newSecret(t), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	tok := jjwt.NewWithClaims(jjwt.SigningMethodRS256, Claims{
		Subject: "alice",
		Profile: "default",
		Roles:   []string{"admin"},
		RegisteredClaims: jjwt.RegisteredClaims{
			IssuedAt:  jjwt.NewNumericDate(now),
			ExpiresAt: jjwt.NewNumericDate(now.Add(time.Hour)),
			Subject:   "alice",
		},
	})
	signed, err := tok.SignedString(rsaKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := iss.Parse(signed); err == nil {
		t.Fatal("expected error parsing RS256 token")
	}
}

// TestParse_RejectsGarbage ensures non-JWT input is rejected without
// panic. A malformed Authorization header is a routine error path.
func TestParse_RejectsGarbage(t *testing.T) {
	iss, err := NewIssuer(newSecret(t), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := iss.Parse("not.a.token"); err == nil {
		t.Fatal("expected error for garbage token")
	}
	if _, err := iss.Parse(""); err == nil {
		t.Fatal("expected error for empty token")
	}
}

// TestParse_TolersClockSkew pins the SEC-F3 (#70) leeway: a token whose
// iat sits a few seconds in the future (e.g. issuing host's clock is
// ahead of the verifier's) must still parse cleanly. Without leeway,
// jwt/v5 rejects iat-in-the-future as "token used before issued".
func TestParse_TolersClockSkew(t *testing.T) {
	iss, err := NewIssuer(newSecret(t), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	// Mint a token whose iat is 30 s in the future — well inside the
	// 60 s leeway clockLeeway constant.
	now := time.Now()
	future := now.Add(30 * time.Second)
	tok := jjwt.NewWithClaims(jjwt.SigningMethodHS256, Claims{
		Subject: "alice",
		Profile: "default",
		Roles:   []string{"reader"},
		RegisteredClaims: jjwt.RegisteredClaims{
			IssuedAt:  jjwt.NewNumericDate(future),
			NotBefore: jjwt.NewNumericDate(future),
			ExpiresAt: jjwt.NewNumericDate(future.Add(time.Hour)),
			Subject:   "alice",
		},
	})
	signed, err := tok.SignedString(iss.secret)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := iss.Parse(signed); err != nil {
		t.Fatalf("expected leeway to tolerate +30s skew, got: %v", err)
	}
}

func TestIssueAndParse_ConnectionID(t *testing.T) {
	secret := bytes.Repeat([]byte("k"), 32)
	iss, err := NewIssuer(secret, time.Hour)
	if err != nil {
		t.Fatalf("NewIssuer: %v", err)
	}
	tok, _, err := iss.Issue("alice", "default", []string{"admin"}, "conn-abc-123")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	claims, err := iss.Parse(tok)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if claims.ConnectionID != "conn-abc-123" {
		t.Errorf("ConnectionID = %q, want %q", claims.ConnectionID, "conn-abc-123")
	}
	if claims.Subject != "alice" || claims.Profile != "default" {
		t.Errorf("other claims drifted: %+v", claims)
	}
}

// TestParse_LegacyNoCidClaim proves that a token minted by the
// underlying library WITHOUT any `cid` field at all (not just cid: "")
// parses cleanly with ConnectionID == "". This pins the backwards-compat
// guarantee for Plan A tokens that predate the cid claim.
func TestParse_LegacyNoCidClaim(t *testing.T) {
	secret := bytes.Repeat([]byte("k"), 32)
	iss, err := NewIssuer(secret, time.Hour)
	if err != nil {
		t.Fatalf("NewIssuer: %v", err)
	}

	// Mint a token without any cid claim — mirrors Plan A's wire shape.
	type legacyClaims struct {
		Subject string   `json:"sub"`
		Profile string   `json:"profile"`
		Roles   []string `json:"roles"`
		jjwt.RegisteredClaims
	}
	now := time.Now()
	tok := jjwt.NewWithClaims(jjwt.SigningMethodHS256, legacyClaims{
		Subject: "alice",
		Profile: "default",
		Roles:   []string{"admin"},
		RegisteredClaims: jjwt.RegisteredClaims{
			IssuedAt:  jjwt.NewNumericDate(now),
			ExpiresAt: jjwt.NewNumericDate(now.Add(time.Hour)),
			Subject:   "alice",
		},
	})
	signed, err := tok.SignedString(secret)
	if err != nil {
		t.Fatalf("SignedString: %v", err)
	}

	claims, err := iss.Parse(signed)
	if err != nil {
		t.Fatalf("Parse legacy token: %v", err)
	}
	if claims.ConnectionID != "" {
		t.Errorf("ConnectionID = %q, want empty (legacy token has no cid)", claims.ConnectionID)
	}
	if claims.Subject != "alice" || claims.Profile != "default" {
		t.Errorf("other claims drifted: %+v", claims)
	}
}

// TestParse_RejectsExpiredBeyondLeeway pins the upper bound: a token
// whose exp is more than the leeway window in the past must still be
// rejected. Closes the "leeway accidentally widens replay window"
// concern.
func TestParse_RejectsExpiredBeyondLeeway(t *testing.T) {
	iss, err := NewIssuer(newSecret(t), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	pastIat := now.Add(-2 * time.Hour)
	pastExp := now.Add(-2 * time.Minute) // far past clockLeeway = 60s
	tok := jjwt.NewWithClaims(jjwt.SigningMethodHS256, Claims{
		Subject: "alice",
		Profile: "default",
		RegisteredClaims: jjwt.RegisteredClaims{
			IssuedAt:  jjwt.NewNumericDate(pastIat),
			ExpiresAt: jjwt.NewNumericDate(pastExp),
			Subject:   "alice",
		},
	})
	signed, err := tok.SignedString(iss.secret)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := iss.Parse(signed); err == nil {
		t.Fatal("expected expired-beyond-leeway token to be rejected")
	}
}
