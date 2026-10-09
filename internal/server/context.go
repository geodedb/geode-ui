package server

import (
	"context"
	"strings"
	"time"
)

// timeNow is a test seam for any handler that wants a deterministic clock.
//
//nolint:gochecknoglobals // test seam: tests swap the clock for deterministic expiry maths.
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
	// cidCtxKey is the JWT "cid" (connection ID) claim placed in context
	// by AuthJWT. Empty string for legacy single-session tokens.
	cidCtxKey
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

// actor bundles the authenticated caller's identity and roles as extracted
// from the JWT by AuthJWT. Subject is the upstream Geode username ("sub"
// claim); Roles is the list of roles carried in the token; ConnectionID
// is the JWT "cid" claim (empty for legacy single-session tokens).
type actor struct {
	Subject      string
	Roles        []string
	ConnectionID string
}

// actorFromContext reconstructs the actor for the current request using the
// values placed in ctx by AuthJWT (userCtxKey → Subject, rolesCtxKey →
// Roles, cidCtxKey → ConnectionID). Returns a zero actor if the middleware
// has not run.
func actorFromContext(ctx context.Context) actor {
	var a actor
	if v, ok := ctx.Value(userCtxKey).(string); ok {
		a.Subject = v
	}
	if v, ok := ctx.Value(rolesCtxKey).([]string); ok {
		a.Roles = v
	}
	if v, ok := ctx.Value(cidCtxKey).(string); ok {
		a.ConnectionID = v
	}
	return a
}

// connectionIDFromContext reads the JWT's `cid` claim previously placed
// in ctx by AuthJWT. Returns "" if the middleware didn't run or the
// JWT carried no cid (legacy single-session tokens).
func connectionIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(cidCtxKey).(string); ok {
		return v
	}
	return ""
}

// hasRole reports whether the role list contains the named role,
// case-insensitively. Empty role list returns false for any name.
func hasRole(roles []string, name string) bool {
	for _, r := range roles {
		if strings.EqualFold(r, name) {
			return true
		}
	}
	return false
}
