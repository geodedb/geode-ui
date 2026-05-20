package jwt

import (
	"bytes"
	"strings"
	"testing"
	"time"

	jjwt "github.com/golang-jwt/jwt/v5"
)

// secret32WithSentinel returns a 32-byte secret prefixed with `tag` so
// the test failure messages can tell which secret signed/verified a
// token without dumping bytes.
func secret32WithSentinel(tag byte) []byte {
	b := bytes.Repeat([]byte{0xA0}, 32)
	b[0] = tag
	return b
}

// TestIssue_StampsKidHeader_SEC_NEW_7 pins SEC-NEW-7 (#210): every
// issued token must carry the active kid in its JWS header. The header
// is signed alongside the payload so an attacker can't rewrite kid.
func TestIssue_StampsKidHeader_SEC_NEW_7(t *testing.T) {
	secret := secret32WithSentinel('A')
	iss, err := NewIssuer(secret, time.Hour)
	if err != nil {
		t.Fatalf("NewIssuer: %v", err)
	}
	tok, _, err := iss.Issue("alice", "default", []string{"user"}, "")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	// Re-parse with the same library to inspect the header.
	parsed, _, err := new(jjwt.Parser).ParseUnverified(tok, &Claims{})
	if err != nil {
		t.Fatalf("ParseUnverified: %v", err)
	}
	kid, ok := parsed.Header["kid"].(string)
	if !ok || kid == "" {
		t.Fatalf("SEC-NEW-7 #210: kid header missing or wrong type: %v", parsed.Header["kid"])
	}
	if kid != DefaultKID {
		t.Fatalf("SEC-NEW-7 #210: kid=%q want %q (default for NewIssuer)", kid, DefaultKID)
	}
}

// TestParse_RotatingKeys_AcceptsBothKids_SEC_NEW_7 pins the core
// rotation contract: an Issuer constructed with TWO secrets keyed by
// kid must verify a token signed under EITHER kid, until the operator
// drops the previous secret from the map.
func TestParse_RotatingKeys_AcceptsBothKids_SEC_NEW_7(t *testing.T) {
	previous := secret32WithSentinel('P')
	current := secret32WithSentinel('C')

	// Phase 1: pre-rotation Issuer signing under "previous".
	preIssuer, err := NewIssuerWithKeys(map[string][]byte{PreviousKID: previous}, PreviousKID, time.Hour)
	if err != nil {
		t.Fatalf("preIssuer: %v", err)
	}
	preTok, _, err := preIssuer.Issue("alice", "default", []string{"user"}, "")
	if err != nil {
		t.Fatalf("preIssuer.Issue: %v", err)
	}

	// Phase 2: rotated Issuer with BOTH secrets, active=current.
	rotIssuer, err := NewIssuerWithKeys(map[string][]byte{
		PreviousKID: previous,
		DefaultKID:  current, // "current"
	}, DefaultKID, time.Hour)
	if err != nil {
		t.Fatalf("rotIssuer: %v", err)
	}
	// Old token still verifies during the rotation window.
	if _, err := rotIssuer.Parse(preTok); err != nil {
		t.Fatalf("SEC-NEW-7 #210: pre-rotation token rejected during window: %v", err)
	}
	// New tokens flow under the active kid.
	newTok, _, err := rotIssuer.Issue("bob", "default", []string{"user"}, "")
	if err != nil {
		t.Fatalf("rotIssuer.Issue: %v", err)
	}
	parsedNew, _, err := new(jjwt.Parser).ParseUnverified(newTok, &Claims{})
	if err != nil {
		t.Fatalf("ParseUnverified: %v", err)
	}
	if kid, _ := parsedNew.Header["kid"].(string); kid != DefaultKID {
		t.Fatalf("SEC-NEW-7 #210: post-rotation token kid=%q want %q", kid, DefaultKID)
	}
	if _, err := rotIssuer.Parse(newTok); err != nil {
		t.Fatalf("SEC-NEW-7 #210: post-rotation token rejected by its own Issuer: %v", err)
	}

	// Phase 3: post-rotation Issuer drops "previous". Old token MUST fail.
	postIssuer, err := NewIssuerWithKeys(map[string][]byte{DefaultKID: current}, DefaultKID, time.Hour)
	if err != nil {
		t.Fatalf("postIssuer: %v", err)
	}
	if _, err := postIssuer.Parse(preTok); err == nil {
		t.Fatalf("SEC-NEW-7 #210: pre-rotation token still accepted after previous secret was dropped — rotation never completes")
	}
	if _, err := postIssuer.Parse(newTok); err != nil {
		t.Fatalf("SEC-NEW-7 #210: post-rotation token rejected after previous dropped: %v", err)
	}
}

// TestParse_RotatingKeys_RejectsUnknownKid_SEC_NEW_7 pins that an
// attacker who forges a token with kid="brand-new-name" cannot pick a
// known weaker secret by accident — Parse hard-fails on unknown kids.
func TestParse_RotatingKeys_RejectsUnknownKid_SEC_NEW_7(t *testing.T) {
	current := secret32WithSentinel('C')
	iss, err := NewIssuerWithKeys(map[string][]byte{DefaultKID: current}, DefaultKID, time.Hour)
	if err != nil {
		t.Fatalf("NewIssuerWithKeys: %v", err)
	}
	tok := jjwt.NewWithClaims(jjwt.SigningMethodHS256, Claims{
		Subject: "evil",
		RegisteredClaims: jjwt.RegisteredClaims{
			IssuedAt:  jjwt.NewNumericDate(time.Now()),
			ExpiresAt: jjwt.NewNumericDate(time.Now().Add(time.Hour)),
			Subject:   "evil",
		},
	})
	tok.Header["kid"] = "not-a-real-kid"
	signed, err := tok.SignedString(current)
	if err != nil {
		t.Fatalf("SignedString: %v", err)
	}
	if _, err := iss.Parse(signed); err == nil {
		t.Fatalf("SEC-NEW-7 #210: token with unknown kid accepted — kid pinning is broken")
	} else if !strings.Contains(err.Error(), "unknown kid") {
		t.Fatalf("SEC-NEW-7 #210: unexpected error %v; want one mentioning 'unknown kid'", err)
	}
}

// TestNewIssuerWithKeys_Validation pins the four input-validation
// invariants on the new constructor.
func TestNewIssuerWithKeys_Validation(t *testing.T) {
	t.Run("empty keys map rejected", func(t *testing.T) {
		_, err := NewIssuerWithKeys(map[string][]byte{}, "current", time.Hour)
		if err == nil {
			t.Fatalf("want error on empty keys map")
		}
	})
	t.Run("activeKID missing from keys rejected", func(t *testing.T) {
		_, err := NewIssuerWithKeys(map[string][]byte{"current": secret32WithSentinel('A')}, "elsewhere", time.Hour)
		if err == nil {
			t.Fatalf("want error when activeKID is not in keys")
		}
	})
	t.Run("short secret in map rejected", func(t *testing.T) {
		_, err := NewIssuerWithKeys(map[string][]byte{"current": {0x01, 0x02}}, "current", time.Hour)
		if err == nil {
			t.Fatalf("want error on short secret")
		}
	})
	t.Run("ttl outside 1m..24h rejected", func(t *testing.T) {
		_, err := NewIssuerWithKeys(map[string][]byte{"current": secret32WithSentinel('A')}, "current", time.Second)
		if err == nil {
			t.Fatalf("want error on ttl<1m")
		}
	})
}

// TestActiveKIDAndKnownKIDs pins the two introspection helpers used
// by the rotation runbook.
func TestActiveKIDAndKnownKIDs(t *testing.T) {
	iss, err := NewIssuerWithKeys(map[string][]byte{
		"current":  secret32WithSentinel('C'),
		"previous": secret32WithSentinel('P'),
		"older":    secret32WithSentinel('O'),
	}, "current", time.Hour)
	if err != nil {
		t.Fatalf("NewIssuerWithKeys: %v", err)
	}
	if got := iss.ActiveKID(); got != "current" {
		t.Fatalf("ActiveKID=%q want current", got)
	}
	known := iss.KnownKIDs()
	want := []string{"current", "older", "previous"} // sorted
	if len(known) != len(want) {
		t.Fatalf("KnownKIDs len=%d want %d", len(known), len(want))
	}
	for i := range want {
		if known[i] != want[i] {
			t.Fatalf("KnownKIDs[%d]=%q want %q", i, known[i], want[i])
		}
	}
}

// TestParse_LegacyTokensWithoutKidStillVerify pins the back-compat
// fallback: tokens minted before kid support landed (no header.kid)
// still verify against the activeKID's secret. This keeps in-flight
// tokens valid across the deploy that adds kid support.
func TestParse_LegacyTokensWithoutKidStillVerify(t *testing.T) {
	current := secret32WithSentinel('C')
	iss, err := NewIssuerWithKeys(map[string][]byte{DefaultKID: current}, DefaultKID, time.Hour)
	if err != nil {
		t.Fatalf("NewIssuerWithKeys: %v", err)
	}
	// Hand-build a token without setting the kid header — emulates a
	// token issued by the pre-kid Issuer.
	tok := jjwt.NewWithClaims(jjwt.SigningMethodHS256, Claims{
		Subject: "legacy",
		RegisteredClaims: jjwt.RegisteredClaims{
			IssuedAt:  jjwt.NewNumericDate(time.Now()),
			ExpiresAt: jjwt.NewNumericDate(time.Now().Add(time.Hour)),
			Subject:   "legacy",
		},
	})
	// Defensively remove any kid the library may have stamped.
	delete(tok.Header, "kid")
	signed, err := tok.SignedString(current)
	if err != nil {
		t.Fatalf("SignedString: %v", err)
	}
	c, err := iss.Parse(signed)
	if err != nil {
		t.Fatalf("SEC-NEW-7 #210: legacy (no-kid) token rejected: %v", err)
	}
	if c.Subject != "legacy" {
		t.Fatalf("Parse claims.Subject=%q want legacy", c.Subject)
	}
}

// S-NEW-E (#313): rotation under incident response. The operator-
// expectation is "every existing token is invalid after this call."
// RotateAndRevokeAll replaces the keys map atomically so tokens signed
// under any prior kid hit the unknown-kid hard-fail in Parse.
func TestRotateAndRevokeAll_InvalidatesPriorTokens_S_NEW_E(t *testing.T) {
	previous := make([]byte, 32)
	for i := range previous {
		previous[i] = byte(i + 1)
	}
	iss, err := NewIssuerWithKeys(
		map[string][]byte{PreviousKID: previous},
		PreviousKID,
		time.Hour,
	)
	if err != nil {
		t.Fatalf("NewIssuerWithKeys: %v", err)
	}
	// Mint a token under the previous secret.
	preToken, _, err := iss.Issue("alice", "p", []string{"r"}, "")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	// Sanity: the pre-rotation token parses.
	if _, err := iss.Parse(preToken); err != nil {
		t.Fatalf("pre-rotation Parse: %v", err)
	}

	// Rotate.
	newSecret := make([]byte, 32)
	for i := range newSecret {
		newSecret[i] = byte(0xff - i)
	}
	priorKID, err := iss.RotateAndRevokeAll("incident-2026-05-20", newSecret)
	if err != nil {
		t.Fatalf("RotateAndRevokeAll: %v", err)
	}
	if priorKID != PreviousKID {
		t.Fatalf("priorKID = %q, want %q", priorKID, PreviousKID)
	}

	// Every prior-kid token must now fail.
	if _, err := iss.Parse(preToken); err == nil {
		t.Fatal("RotateAndRevokeAll did not invalidate the prior-kid token")
	}

	// Freshly-issued tokens under the new kid parse cleanly.
	postToken, _, err := iss.Issue("alice", "p", []string{"r"}, "")
	if err != nil {
		t.Fatalf("post-rotation Issue: %v", err)
	}
	if _, err := iss.Parse(postToken); err != nil {
		t.Fatalf("post-rotation Parse: %v", err)
	}
}

func TestRotateAndRevokeAll_RejectsEmptyArgs_S_NEW_E(t *testing.T) {
	current := make([]byte, 32)
	for i := range current {
		current[i] = byte(i + 1)
	}
	iss, err := NewIssuerWithKeys(
		map[string][]byte{DefaultKID: current},
		DefaultKID,
		time.Hour,
	)
	if err != nil {
		t.Fatalf("NewIssuerWithKeys: %v", err)
	}
	if _, err := iss.RotateAndRevokeAll("", []byte("x")); err == nil {
		t.Error("RotateAndRevokeAll accepted empty kid")
	}
	if _, err := iss.RotateAndRevokeAll("k", nil); err == nil {
		t.Error("RotateAndRevokeAll accepted empty secret")
	}
}
