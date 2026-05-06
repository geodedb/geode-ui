package server

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"encoding/json/jsontext"
	"encoding/json/v2"
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
	// (e.g. picked from the "X-Geode-Profile" header by middleware in B9).
	profileCtxKey ctxKey = iota + 1
)

// profileFromContext returns the connection-profile name attached to ctx,
// or "" if no middleware set one.
//
//nolint:unused // wired up in B-series JWT/middleware tasks.
func profileFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(profileCtxKey).(string); ok {
		return v
	}
	return ""
}

// profileFromContextOrDefault returns the profile from ctx or "default" when
// none is set, which matches the bootstrap profile loaded by main.go.
func profileFromContextOrDefault(ctx context.Context) string {
	if v := profileFromContext(ctx); v != "" {
		return v
	}
	return "default"
}

// sanitizeGraphName returns name stripped of anything that is not a safe
// identifier character so it can be inlined into a `USE GRAPH` prefix
// without opening an injection vector. Geode graph names are
// alphanumeric/underscore/hyphen by convention.
func sanitizeGraphName(name string) string {
	var b strings.Builder
	b.Grow(len(name))
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '_', r == '-':
			b.WriteRune(r)
		}
	}
	return b.String()
}

// namedArgs converts a JSON-encoded params object into a slice of
// sql.NamedArg suitable for db.QueryContext. Non-object inputs (or empty)
// produce a nil slice. Each property becomes one sql.Named entry.
//
// Values are passed through as decoded Go primitives (string/float64/bool/
// nil/[]any/map[string]any) — driver-side parameter coercion is the geode
// driver's responsibility.
func namedArgs(raw jsontext.Value) []any {
	if len(raw) == 0 {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	if len(m) == 0 {
		return nil
	}
	args := make([]any, 0, len(m))
	for k, v := range m {
		args = append(args, sql.Named(k, v))
	}
	return args
}
