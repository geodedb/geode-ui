package server

import (
	"context"
	"time"
)

// timeNow is a test seam for any handler that wants a deterministic clock.
//
//nolint:unused // kept for B-series handlers that will need a clock seam.
var timeNow = time.Now

// ctxKey is a private type for context keys to avoid collisions with other
// packages.
type ctxKey int

const (
	// profileCtxKey is the connection-profile name selected for the request
	// (sourced from the JWT "profile" claim by AuthJWT in auth.go).
	profileCtxKey ctxKey = iota + 1
	// userCtxKey is the authenticated subject (upstream Geode username),
	// sourced from the JWT "sub" claim.
	userCtxKey
	// rolesCtxKey is the roles claim ([]string) carried in the JWT and
	// used by genapi's required_roles enforcement.
	rolesCtxKey
	// authSourceCtxKey records which transport AuthJWT used to extract
	// the JWT (Authorization header, cookie, or querystring). Read by
	// the CSRF middleware (S3b / SEC-F7) to decide whether a request is
	// in scope for double-submit enforcement.
	authSourceCtxKey
)

// profileFromContext returns the connection-profile name attached to ctx,
// or "" if no middleware set one.
func profileFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(profileCtxKey).(string); ok {
		return v
	}
	return ""
}

// rolesFromContext returns the JWT roles claim attached to ctx by the
// AuthJWT middleware, or nil if none was set.
//
//nolint:unused // wired up by AuthJWT; reserved for required_roles tests.
func rolesFromContext(ctx context.Context) []string {
	if v, ok := ctx.Value(rolesCtxKey).([]string); ok {
		return v
	}
	return nil
}

// profileFromContextOrDefault returns the profile from ctx or "default" when
// none is set, which matches the bootstrap profile loaded by main.go.
func profileFromContextOrDefault(ctx context.Context) string {
	if v := profileFromContext(ctx); v != "" {
		return v
	}
	return "default"
}
