package server

import (
	"fmt"
	"strings"
)

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
