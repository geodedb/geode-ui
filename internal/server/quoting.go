package server

import (
	"errors"
	"strings"
)

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

// errInvalidIdent / errInvalidString surface for quoteIdent / quoteString
// when the input contains characters that cannot be safely escaped without
// risking a parser-level injection. Handlers translate these into 400
// endpointError responses.
var (
	errInvalidIdent  = errors.New("identifier contains forbidden characters")
	errInvalidString = errors.New("string literal contains forbidden characters")
)

// quoteIdent returns name in a form safe to inline into a GQL admin
// statement that takes an identifier (e.g. CREATE USER name).
//
// Geode v0.5.15's lexer (src/gql/lexer.zig) currently has a
// scanQuotedIdentifier function that is defined but UNREACHABLE -- the
// dispatch path treats `"..."` as a string literal, not a delimited
// identifier, and `parseName` only matches the `.identifier` token kind
// for callers that go through it. Backtick is not part of the lexer's
// dispatch table at all, so a backtick-delimited name surfaces as a
// `expected a name (identifier)` 42000 parse error.
//
// That leaves no upstream-accepted delimiter we can use to escape an
// arbitrary user-supplied name. The only safe form is a bare identifier
// that already matches the upstream identifier-shape (the GQL/SQL
// identifier-shape is `[A-Za-z_][A-Za-z_0-9-]*` -- letters, digits,
// underscore, hyphen, starting with a letter or underscore). We
// validate against that shape and emit the name verbatim. Any input
// outside the shape (whitespace, punctuation, control, multi-byte) is
// rejected at the handler boundary with a 400 invalid_<field> error
// before the value reaches the wire.
//
// All B-series user/role/policy handlers that string-concatenate a
// caller-controlled identifier into a GQL statement MUST route the value
// through this helper.
func quoteIdent(name string) (string, error) {
	if name == "" {
		return "", errInvalidIdent
	}
	first := true
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r == '_':
			// Always allowed.
		case r >= '0' && r <= '9':
			// Digits allowed anywhere (some upstream catalogs use
			// digit-prefix names like `005_add_index` for migrations).
		case r == '-':
			// Hyphen allowed only after the first byte to avoid
			// option-confusion if a downstream emitter splits args.
			if first {
				return "", errInvalidIdent
			}
		default:
			return "", errInvalidIdent
		}
		first = false
	}
	return name, nil
}

// quoteString returns s wrapped in single quotes, safe for inlining
// into a GQL single-quoted string literal. It rejects any ASCII
// control character first (so a value like "foo\nDROP TABLE" cannot
// smuggle a newline into the literal), then escapes the value.
//
// Escape order is load-bearing. GQL accepts BOTH a doubled single
// quote and a backslash-escaped single quote inside a single-quoted
// literal, so a literal backslash must be doubled (\ -> \\) BEFORE
// single quotes are doubled (' -> two single quotes). Doing it the
// other way round would let a payload of backslash+quote produce
// literal-quote, backslash, quote, quote -- which the parser reads as
// a backslash-escaped quote followed by an unescaped quote, breaking
// out of the literal. This mirrors the authoritative geode-client-go
// gqlStringEscaper (conn.go).
func quoteString(s string) (string, error) {
	for _, r := range s {
		if r < 0x20 || r == 0x7f {
			return "", errInvalidString
		}
	}
	// Backslash FIRST, then single quotes. Order is critical -- see doc.
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, "'", "''")
	return "'" + s + "'", nil
}
