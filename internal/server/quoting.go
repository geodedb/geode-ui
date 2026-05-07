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
