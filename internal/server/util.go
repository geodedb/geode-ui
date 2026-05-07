package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
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
	// (sourced from the JWT "profile" claim by AuthJWT in auth.go).
	profileCtxKey ctxKey = iota + 1
	// userCtxKey is the authenticated subject (upstream Geode username),
	// sourced from the JWT "sub" claim.
	userCtxKey
	// rolesCtxKey is the roles claim ([]string) carried in the JWT and
	// used by genapi's required_roles enforcement.
	rolesCtxKey
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

// runQuery executes stmt against db with optional named arguments and
// materialises the full result set into ([][]any, []string, nil) where the
// first return is the rows (one []any per row, one element per column) and
// the second is the column names in driver order.
//
// It is intended for short, fixed-shape catalog statements (SHOW GRAPHS,
// CALL db.labels(), SHOW INDEXES, …) — multiple B-series handlers use it.
// Long-running streaming queries should iterate rows directly to avoid
// buffering the whole result set in memory.
func runQuery(ctx context.Context, db *sql.DB, stmt string, args ...any) ([][]any, []string, error) {
	rows, err := db.QueryContext(ctx, stmt, args...)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = rows.Close() }()

	cols, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}

	var out [][]any
	for rows.Next() {
		row := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range row {
			ptrs[i] = &row[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, nil, err
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return out, cols, nil
}

// runStatement executes stmt against db with optional named arguments and
// returns the driver's sql.Result. It is the DDL/DML counterpart to
// runQuery — administrative commands like CREATE USER, DROP USER, ALTER
// USER, GRANT, and REVOKE typically have no result set, so the user-
// management handlers funnel them through here. Errors are returned
// untouched so the caller can wrap them with handler-specific endpoint
// codes.
func runStatement(ctx context.Context, db *sql.DB, stmt string, args ...any) (sql.Result, error) {
	return db.ExecContext(ctx, stmt, args...)
}

// isWireFeatureMissing reports whether err looks like a parse error from
// the upstream Geode — i.e. the engine doesn't recognize the GQL syntax
// at all on this version of the wire. Several admin reads (SHOW USERS /
// ROLES / POLICIES / BACKUPS / MIGRATIONS) trip this on Geode v0.5.11
// because the catalog DDL hasn't shipped on the wire yet. Read handlers
// use this to degrade gracefully to an empty list (HTTP 200) rather
// than surfacing a 422 to the UI on every page load.
//
// Mirrors the isAuthError shape: prefer typed StatusClass() if available,
// fall back to substring match on the wrapped error text.
func isWireFeatureMissing(err error) bool {
	if err == nil {
		return false
	}
	// First: prefer typed StatusClass if available.
	type statusClasser interface{ StatusClass() string }
	var sc statusClasser
	if errors.As(err, &sc) && sc.StatusClass() == "42000" {
		return true
	}
	// Fall through to substring detection — drivers that don't expose
	// StatusClass() (or that wrap the err in a way that loses it) still
	// embed the canonical `<class>: <message>` shape in the error text.
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "42000") &&
		(strings.Contains(msg, "parse error") ||
			strings.Contains(msg, "expected token") ||
			strings.Contains(msg, "expected identifier"))
}

// errInvalidIdent / errInvalidString surface for quoteIdent / quoteString
// when the input contains characters that cannot be safely escaped without
// risking a parser-level injection. Handlers translate these into 400
// endpointError responses.
var (
	errInvalidIdent  = errors.New("identifier contains forbidden characters")
	errInvalidString = errors.New("string literal contains forbidden characters")
)

// quoteIdent returns name wrapped in backticks, suitable for inlining into
// a GQL admin statement that takes a quoted identifier (e.g. CREATE USER
// `name`). It rejects any input containing a backtick or ASCII control
// character — both would let the caller break out of the quoted span and
// inject arbitrary syntax.
//
// All B-series user/role/policy handlers that string-concatenate a
// caller-controlled identifier into a GQL statement MUST route the value
// through this helper.
func quoteIdent(name string) (string, error) {
	if name == "" {
		return "", errInvalidIdent
	}
	for _, r := range name {
		if r == '`' || r < 0x20 || r == 0x7f {
			return "", errInvalidIdent
		}
	}
	return "`" + name + "`", nil
}

// quoteString returns s wrapped in single quotes with internal single
// quotes doubled (the standard SQL/GQL escape). It rejects any ASCII
// control character so a value like "foo\nDROP TABLE" cannot smuggle a
// newline into the quoted literal.
func quoteString(s string) (string, error) {
	for _, r := range s {
		if r < 0x20 || r == 0x7f {
			return "", errInvalidString
		}
	}
	return "'" + strings.ReplaceAll(s, "'", "''") + "'", nil
}

// asStr coerces a driver-returned column value to a string. STRING columns
// from the geode driver scan as string, but other column types may surface
// as []byte or primitives; fmt.Sprint handles all of them with no surprises.
func asStr(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case []byte:
		return string(t)
	default:
		return fmt.Sprint(t)
	}
}

// asBool coerces a driver-returned column value to a bool. The geode
// driver returns BOOLEAN columns as bool but historic versions emitted
// them as string ("true"/"false") or 0/1; this helper normalises all of
// those.
func asBool(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case []byte:
		return strings.EqualFold(string(t), "true") || string(t) == "1"
	case string:
		return strings.EqualFold(t, "true") || t == "1"
	case int64:
		return t != 0
	case int:
		return t != 0
	default:
		return false
	}
}

// asStrs coerces a driver-returned column value to a []string. The geode
// driver scans LIST<STRING> as []any; we tolerate []string and a
// comma-or-pipe-separated string fallback so the handler keeps working
// across driver versions.
func asStrs(v any) []string {
	switch t := v.(type) {
	case nil:
		return nil
	case []string:
		return append([]string(nil), t...)
	case []any:
		out := make([]string, 0, len(t))
		for _, e := range t {
			out = append(out, asStr(e))
		}
		return out
	case string:
		if t == "" {
			return nil
		}
		// Tolerate comma-separated fallback that some Geode versions emit.
		return splitListString(t)
	case []byte:
		return asStrs(string(t))
	default:
		return nil
	}
}

// splitListString splits a comma- or pipe-separated string into entries
// with whitespace trimmed. Empty entries are dropped.
func splitListString(s string) []string {
	sep := ","
	if !strings.Contains(s, ",") && strings.Contains(s, "|") {
		sep = "|"
	}
	raw := strings.Split(s, sep)
	out := make([]string, 0, len(raw))
	for _, r := range raw {
		if v := strings.TrimSpace(r); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// namedArgs converts a JSON-encoded params object into a slice of
// sql.NamedArg suitable for db.QueryContext. Empty/null/missing input
// returns (nil, nil); a syntactically invalid JSON value returns the
// underlying decode error so the handler can surface a 400 rather than
// silently dropping the parameters. Each property becomes one sql.Named
// entry.
//
// Values are passed through as decoded Go primitives (string/float64/bool/
// nil/[]any/map[string]any) — driver-side parameter coercion is the geode
// driver's responsibility.
func namedArgs(raw jsontext.Value) ([]any, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	if len(m) == 0 {
		return nil, nil
	}
	args := make([]any, 0, len(m))
	for k, v := range m {
		args = append(args, sql.Named(k, v))
	}
	return args, nil
}
