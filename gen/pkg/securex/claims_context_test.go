package securex

import (
	"context"
	"testing"
)

// TestClaimsFromContext_AbsentReturnsZero proves the accessor returns
// (nil, false) when no claims have been stashed. This is the
// fail-closed default — handlers that read ClaimsFromContext on a
// path that never authenticated will see ok==false instead of panicking.
func TestClaimsFromContext_AbsentReturnsZero(t *testing.T) {
	got, ok := ClaimsFromContext(context.Background())
	if ok || got != nil {
		t.Fatalf("ClaimsFromContext on empty ctx = (%v, %v), want (nil, false)", got, ok)
	}
}

// TestContextWithClaims_RoundTrip proves that ContextWithClaims +
// ClaimsFromContext is symmetric. The accessor must return the exact
// pointer (not a copy) so callers can mutate Attributes if their
// downstream contract requires it.
func TestContextWithClaims_RoundTrip(t *testing.T) {
	want := &Claims{
		Subject: "alice",
		Roles:   []string{"admin"},
		Scopes:  []string{"read", "write"},
	}
	ctx := ContextWithClaims(context.Background(), want)
	got, ok := ClaimsFromContext(ctx)
	if !ok {
		t.Fatalf("ClaimsFromContext returned ok=false on enriched ctx")
	}
	if got != want {
		t.Fatalf("ClaimsFromContext returned different pointer: got %p, want %p", got, want)
	}
	if got.Subject != "alice" || got.HighestRole() != RoleAdmin {
		t.Fatalf("claims content corrupted: %+v", got)
	}
}

// TestContextWithClaims_NilIsTransparent proves passing a nil claims
// pointer does not panic and ClaimsFromContext reports ok=false.
// This covers the case where a verifier wants to mark the context as
// "auth ran" without attaching claims.
func TestContextWithClaims_NilIsTransparent(t *testing.T) {
	ctx := ContextWithClaims(context.Background(), nil)
	got, ok := ClaimsFromContext(ctx)
	if ok {
		t.Fatalf("ClaimsFromContext on nil-claims ctx = (%v, true), want (nil, false)", got)
	}
}

// TestContextWithClaims_NilContextIsSafe proves passing a nil ctx
// returns a non-nil derived ctx so downstream code that always
// derives from the result does not crash. This mirrors the existing
// ContextWithRoles behaviour in pkg/mcpx/engine.go. The nil input
// is the explicit fail-safe contract we are testing here, hence the
// staticcheck suppression.
func TestContextWithClaims_NilContextIsSafe(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("ContextWithClaims(nil, claims) panicked: %v", r)
		}
	}()
	c := &Claims{Subject: "bob"}
	//nolint:staticcheck // SA1012: testing the documented nil-ctx fallback path
	ctx := ContextWithClaims(nil, c)
	if ctx == nil {
		t.Fatalf("ContextWithClaims(nil, claims) returned nil ctx")
	}
	got, ok := ClaimsFromContext(ctx)
	if !ok || got != c {
		t.Fatalf("nil-ctx + claims round-trip failed: got=(%v, %v)", got, ok)
	}
}
