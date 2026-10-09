package jwt

import (
	"context"
	"errors"
	"testing"
	"time"

	jjwt "github.com/golang-jwt/jwt/v5"
)

// TestIssuedTokenCarriesJTI pins SEC-N2 AC (1): every token minted by
// the Issuer carries a non-empty crypto/rand jti, and two tokens get
// distinct jtis.
func TestIssuedTokenCarriesJTI(t *testing.T) {
	iss, err := NewIssuer(newSecret(t), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	tok1, _, err := iss.Issue("alice", "default", []string{"reader"}, "")
	if err != nil {
		t.Fatal(err)
	}
	tok2, _, err := iss.Issue("alice", "default", []string{"reader"}, "")
	if err != nil {
		t.Fatal(err)
	}
	c1, err := iss.Parse(tok1)
	if err != nil {
		t.Fatal(err)
	}
	c2, err := iss.Parse(tok2)
	if err != nil {
		t.Fatal(err)
	}
	if c1.ID == "" {
		t.Fatal("token 1 has no jti")
	}
	if len(c1.ID) != 2*jtiBytes {
		t.Fatalf("jti length = %d hex chars, want %d (128 bits)", len(c1.ID), 2*jtiBytes)
	}
	if c1.ID == c2.ID {
		t.Fatalf("two tokens share a jti: %q", c1.ID)
	}
}

// TestParse_NoRevocation_ValidatesNormally is the baseline: a freshly
// minted token validates and round-trips its claims when nothing has
// been revoked.
func TestParse_NoRevocation_ValidatesNormally(t *testing.T) {
	iss, err := NewIssuer(newSecret(t), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	tok, _, err := iss.Issue("bob", "p1", []string{"admin"}, "cid-1")
	if err != nil {
		t.Fatal(err)
	}
	c, err := iss.Parse(tok)
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if c.Subject != "bob" || c.Profile != "p1" || c.ConnectionID != "cid-1" {
		t.Fatalf("claims round-trip mismatch: %+v", c)
	}
}

// TestParse_RevokedByJTI_FailsAfterRevoke pins SEC-N2 AC (2)+(3): after
// Revoke(jti, exp) the same token no longer validates (ErrRevoked),
// while a *different* token (different jti) is unaffected.
func TestParse_RevokedByJTI_FailsAfterRevoke(t *testing.T) {
	iss, err := NewIssuer(newSecret(t), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	tokA, expA, err := iss.Issue("carol", "p", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	tokB, _, err := iss.Issue("carol", "p", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	cA, err := iss.Parse(tokA)
	if err != nil {
		t.Fatal(err)
	}

	// Before revoke: both valid.
	if _, err := iss.Parse(tokA); err != nil {
		t.Fatalf("tokA should be valid before revoke: %v", err)
	}
	if _, err := iss.Parse(tokB); err != nil {
		t.Fatalf("tokB should be valid before revoke: %v", err)
	}

	iss.Revocation().Revoke(cA.ID, expA)

	if _, err := iss.Parse(tokA); !errors.Is(err, ErrRevoked) {
		t.Fatalf("tokA after Revoke: want ErrRevoked, got %v", err)
	}
	if _, err := iss.Parse(tokB); err != nil {
		t.Fatalf("tokB (different jti) should still be valid: %v", err)
	}
}

// TestParse_RevokedByJTI_ExpiredEntryIsHarmless: a Revoke entry whose
// expiry has already passed should not reject the token (the token's
// own TTL guard rejects it instead) and the stale entry is dropped.
func TestParse_RevokedByJTI_ExpiredEntryIsHarmless(t *testing.T) {
	rs := NewRevocationSet()
	c := &Claims{
		Subject:  "dave",
		ID:       "deadbeef",
		IssuedAt: jjwt.NewNumericDate(time.Now().Add(-time.Hour)),
	}
	// Revoke with an expiry in the past.
	rs.Revoke("deadbeef", time.Now().Add(-time.Minute))
	if rs.IsRevoked(c) {
		t.Fatal("an expired revocation entry should not flag the token as revoked")
	}
	// The stale entry should have been pruned by the IsRevoked call.
	if _, ok := rs.revoked.Load("deadbeef"); ok {
		t.Fatal("expected the expired revocation entry to be dropped")
	}
}

// TestParse_RevokeUser_RevokesTokensIssuedBefore pins SEC-N2 AC (4):
// after RevokeUser(sub), a token issued *before* the call fails
// validation, while a token issued *after* the call passes.
func TestParse_RevokeUser_RevokesTokensIssuedBefore(t *testing.T) {
	iss, err := NewIssuer(newSecret(t), time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	// Token minted "before" the password change.
	tokOld, _, err := iss.Issue("erin", "p", []string{"reader"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := iss.Parse(tokOld); err != nil {
		t.Fatalf("old token should be valid before RevokeUser: %v", err)
	}

	// Password change: revoke all of erin's tokens. The old token's iat
	// (whole seconds, ≈ now) is at or before the revoke instant, so it
	// is rejected.
	iss.Revocation().RevokeUser("erin")

	if _, err := iss.Parse(tokOld); !errors.Is(err, ErrRevoked) {
		t.Fatalf("old token after RevokeUser: want ErrRevoked, got %v", err)
	}

	// A token for a *different* subject is unaffected.
	tokOther, _, err := iss.Issue("frank", "p", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := iss.Parse(tokOther); err != nil {
		t.Fatalf("other-subject token should be unaffected: %v", err)
	}

	// A token minted with an iat strictly after the revoke instant
	// validates. We construct one directly (rather than sleeping a full
	// second so a freshly-Issue'd token would have a later whole-second
	// iat) and check it against the revocation set.
	pcaRaw, _ := iss.Revocation().passwordChangedAt.Load("erin")
	pca := pcaRaw.(time.Time)
	freshClaims := &Claims{
		Subject: "erin",
		Profile: "p",
		RegisteredClaims: jjwt.RegisteredClaims{
			ID:       mustJTI(t),
			IssuedAt: jjwt.NewNumericDate(pca.Add(time.Second)),
			Subject:  "erin",
		},
	}
	if iss.Revocation().IsRevoked(freshClaims) {
		t.Fatal("a token issued after the revoke instant must validate")
	}
}

// TestIsRevoked_DefensiveNonTimeEntries pins the defensive branches in
// jtiRevoked / subjectRevokeAll (#144 / Q10): a jti map entry whose value
// is somehow not a time.Time treats the token as revoked (fail closed),
// while a passwordChangedAt entry whose value is not a time.Time is
// ignored (no marker → not revoked). These cases shouldn't occur in
// practice but the behavior is part of the contract.
func TestIsRevoked_DefensiveNonTimeEntries(t *testing.T) {
	rs := NewRevocationSet()

	// Corrupt jti entry → revoked.
	rs.revoked.Store("badjti", "not-a-time")
	cJTI := &Claims{
		ID:       "badjti",
		IssuedAt: jjwt.NewNumericDate(time.Now()),
	}
	if !rs.IsRevoked(cJTI) {
		t.Fatal("a non-time jti revocation entry must flag the token as revoked")
	}

	// Corrupt passwordChangedAt entry → ignored (token not revoked by
	// that mechanism). Use a distinct subject with no jti revocation.
	rs.passwordChangedAt.Store("badsub", 1234)
	cSub := &Claims{
		Subject: "badsub",
		RegisteredClaims: jjwt.RegisteredClaims{
			Subject:  "badsub",
			IssuedAt: jjwt.NewNumericDate(time.Now().Add(-time.Hour)),
		},
	}
	if rs.IsRevoked(cSub) {
		t.Fatal("a non-time passwordChangedAt entry must be ignored, not treated as revoked")
	}
}

func mustJTI(t *testing.T) string {
	t.Helper()
	j, err := newJTI()
	if err != nil {
		t.Fatal(err)
	}
	return j
}

// TestRevokeUser_Monotonic: a second RevokeUser only moves the instant
// forward, never backward.
func TestRevokeUser_Monotonic(t *testing.T) {
	rs := NewRevocationSet()
	t0 := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	rs.nowFn = func() time.Time { return t0.Add(time.Hour) }
	rs.RevokeUser("zed")
	v1, _ := rs.passwordChangedAt.Load("zed")
	// "Older" change attempt — must not move the marker backward.
	rs.nowFn = func() time.Time { return t0 }
	rs.RevokeUser("zed")
	v2, _ := rs.passwordChangedAt.Load("zed")
	if !v1.(time.Time).Equal(v2.(time.Time)) {
		t.Fatalf("RevokeUser moved the marker backward: %v -> %v", v1, v2)
	}
	// Newer change — must move it forward.
	rs.nowFn = func() time.Time { return t0.Add(2 * time.Hour) }
	rs.RevokeUser("zed")
	v3, _ := rs.passwordChangedAt.Load("zed")
	if !v3.(time.Time).After(v1.(time.Time)) {
		t.Fatalf("RevokeUser did not advance the marker: %v -> %v", v1, v3)
	}
}

// TestSweep_DropsExpiredJTIAndStaleUsers pins the pruning behaviour.
func TestSweep_DropsExpiredJTIAndStaleUsers(t *testing.T) {
	rs := NewRevocationSet()
	now := time.Date(2026, 5, 11, 0, 0, 0, 0, time.UTC)
	rs.nowFn = func() time.Time { return now }

	rs.Revoke("live", now.Add(time.Hour))                     // not yet expired — keep
	rs.Revoke("dead", now.Add(-time.Minute))                  // expired — drop
	rs.passwordChangedAt.Store("recent", now.Add(-time.Hour)) // within TTL — keep
	rs.passwordChangedAt.Store("old", now.Add(-48*time.Hour)) // older than TTL — drop

	rs.Sweep(24 * time.Hour)

	if _, ok := rs.revoked.Load("live"); !ok {
		t.Fatal("Sweep dropped a still-valid jti entry")
	}
	if _, ok := rs.revoked.Load("dead"); ok {
		t.Fatal("Sweep kept an expired jti entry")
	}
	if _, ok := rs.passwordChangedAt.Load("recent"); !ok {
		t.Fatal("Sweep dropped a still-relevant passwordChangedAt entry")
	}
	if _, ok := rs.passwordChangedAt.Load("old"); ok {
		t.Fatal("Sweep kept a stale passwordChangedAt entry")
	}
}

// TestStartSweeper_StopsOnContextCancel: the sweeper goroutine exits
// when its context is cancelled (no leak).
func TestStartSweeper_StopsOnContextCancel(t *testing.T) {
	rs := NewRevocationSet()
	ctx, cancel := context.WithCancel(context.Background())
	rs.StartSweeper(ctx, time.Millisecond, time.Hour)
	cancel()
	// Give the goroutine a moment to observe the cancellation. If it
	// didn't, the race detector / goleak (not wired here) would flag it;
	// at minimum this exercises the cancel path without hanging.
	time.Sleep(10 * time.Millisecond)
}

// TestIsRevoked_NilSafe: a nil RevocationSet and nil claims are treated
// as "not revoked".
func TestIsRevoked_NilSafe(t *testing.T) {
	var rs *RevocationSet
	if rs.IsRevoked(&Claims{}) {
		t.Fatal("nil RevocationSet should report not revoked")
	}
	rs = NewRevocationSet()
	if rs.IsRevoked(nil) {
		t.Fatal("nil claims should report not revoked")
	}
}
