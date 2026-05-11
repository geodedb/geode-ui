package server

import (
	"strings"
	"testing"
)

// GAP-N1 (#63): adversarial test corpus for `quoteString` and
// `quoteIdent`. Every input here is a known SQL/Cypher/GQL injection
// shape harvested from OWASP, Stripe's audit corpus, and the
// PortSwigger payloads list. The invariant is the same for every
// case: after the helper runs, the returned literal MUST keep all
// caller-supplied bytes inside the quoted span — i.e. a downstream
// parser handed `prefix + quoted + suffix` must see one and only one
// quoted span between the framing quote chars.
//
// We do NOT require the function to widen its accepted input set
// to handle these payloads. The expected outcome for any character
// that the function deems unsafe is a non-nil error and no quoted
// output. The test enforces that contract uniformly: either accept
// (and round-trip safely) or reject (and produce no quoted output).

// quoteStringRoundTrips returns true if `quoted` is the canonical
// single-quoted form of `raw` with internal single quotes doubled.
// We rebuild the expected representation locally so the test does
// not depend on the helper's own escape pass.
func quoteStringRoundTrips(raw, quoted string) bool {
	expected := "'" + strings.ReplaceAll(raw, "'", "''") + "'"
	return quoted == expected
}

// TestQuoteString_Adversarial enumerates payloads that have, at some
// point in the SQL-injection corpus, broken naive quoting. Every
// payload either round-trips safely or is rejected outright.
func TestQuoteString_Adversarial(t *testing.T) {
	cases := []struct {
		name      string
		in        string
		mustError bool
	}{
		// --- Quote-style injection ---
		{"single_quote_classic", "alice'; DROP TABLE users; --", false},
		{"escaped_single_quote", `alice\' OR 1=1 --`, false},
		{"double_single_quote", "alice'' OR 1=1", false},
		{"trailing_unbalanced_quote", "alice'", false},
		{"leading_unbalanced_quote", "'alice", false},
		{"double_quote_passes_through", `"DROP TABLE"`, false},
		{"backtick_in_string_literal_is_fine", "`alice`", false},

		// --- Comment-style injection ---
		{"sql_line_comment", "alice'--", false},
		{"sql_block_comment", "alice/*evil*/", false},

		// --- Statement-terminator injection ---
		{"trailing_semicolon", "alice; SELECT 1", false},
		{"null_byte_truncation", "alice\x00DROP", true}, // 0x00 control char → reject

		// --- ASCII control characters (all must be rejected) ---
		{"nul_byte", "alice\x00", true},
		{"backspace", "alice\x08", true},
		{"tab", "alice\tbob", true},
		{"newline", "alice\nDROP", true},
		{"vtab", "alice\vbob", true},
		{"formfeed", "alice\fbob", true},
		{"carriage_return", "alice\rDROP", true},
		{"escape", "alice\x1bbob", true},
		{"unit_separator", "alice\x1fbob", true},
		{"delete_char", "alice\x7fbob", true},

		// --- Unicode shenanigans (these are NOT control chars; allowed) ---
		// The GQL parser handles UTF-8 string literals; allowing non-ASCII
		// is correct behaviour. quoteString must NOT widen rejection to
		// these — that would break legitimate i18n usernames/emails.
		{"unicode_basic_latin1", "café'; DROP", false},
		{"unicode_cjk", "用户名", false},
		{"unicode_emoji", "alice🎯", false},
		{"unicode_combining", "aliće", false}, // combining acute over `c`
		{"unicode_zero_width_space", "alic\u200be", false},
		{"unicode_rtl_override", "alic\u202ee", false}, // RTL-OVERRIDE — visually evil, byte-safe
		{"unicode_smuggled_quote", "alic‘e", false},    // U+2018 != U+0027

		// --- Length stress ---
		{"oversized_64k_safe_chars", strings.Repeat("a'b", 22000), false}, // ~66k bytes, only safe chars
		{"oversized_with_control_in_middle", strings.Repeat("a", 30000) + "\x00" + strings.Repeat("b", 30000), true},

		// --- Empty / whitespace ---
		{"empty_string", "", false}, // empty is allowed; produces ''
		{"single_space", " ", false},
		{"only_quotes", "''''", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := quoteString(tc.in)
			if tc.mustError {
				if err == nil {
					t.Fatalf("quoteString(%q)=%q,nil; want non-nil err", tc.in, got)
				}
				if got != "" {
					t.Fatalf("quoteString(%q) on reject path returned non-empty %q", tc.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("quoteString(%q): unexpected err %v", tc.in, err)
			}
			// Framing invariant: starts and ends with single quote.
			if len(got) < 2 || got[0] != '\'' || got[len(got)-1] != '\'' {
				t.Fatalf("quoteString(%q)=%q missing framing quotes", tc.in, got)
			}
			// Round-trip invariant: matches the canonical escape.
			if !quoteStringRoundTrips(tc.in, got) {
				t.Fatalf("quoteString(%q)=%q does not match canonical escape", tc.in, got)
			}
			// Escape correctness: no naked single-quote inside the body.
			// Every single quote in the body must be paired with another
			// single quote ('' = escaped literal). Equivalently, the
			// number of consecutive single quotes inside the body must
			// always be even.
			body := got[1 : len(got)-1]
			runs := consecutiveSingleQuoteRuns(body)
			for _, r := range runs {
				if r%2 != 0 {
					t.Fatalf("quoteString(%q)=%q has odd run of single quotes (%d) -- escape gap", tc.in, got, r)
				}
			}
		})
	}
}

// consecutiveSingleQuoteRuns returns the length of every run of
// consecutive `'` characters in s. Used by the adversarial corpus
// to assert escape correctness: every run must be even-length (each
// caller-supplied `'` is followed by an inserted escape `'`).
func consecutiveSingleQuoteRuns(s string) []int {
	var runs []int
	cur := 0
	for _, c := range s {
		if c == '\'' {
			cur++
			continue
		}
		if cur > 0 {
			runs = append(runs, cur)
			cur = 0
		}
	}
	if cur > 0 {
		runs = append(runs, cur)
	}
	return runs
}

// TestQuoteIdent_Adversarial enumerates identifier-shaped payloads.
// quoteIdent uses backticks and rejects any backtick / ASCII control
// character in the input — there is no escape sequence inside a
// backtick-quoted identifier, so any backtick MUST be rejected.
func TestQuoteIdent_Adversarial(t *testing.T) {
	cases := []struct {
		name      string
		in        string
		mustError bool
	}{
		// Backtick injection — the only way to break out of a
		// backtick-quoted identifier.
		{"backtick_injection_basic", "alice`; DROP USER `bob", true},
		{"trailing_backtick", "alice`", true},
		{"leading_backtick", "`alice", true},
		{"double_backtick", "alice``bob", true},
		{"escaped_backtick_unicode_lookalike", "alic‘e", false}, // not an ASCII backtick → allowed

		// Empty / whitespace
		{"empty_string_rejected", "", true},
		{"single_space_allowed_inside_backticks", " ", false},

		// Control characters (rejected wholesale)
		{"nul_byte", "alice\x00", true},
		{"tab", "alice\tbob", true},
		{"newline", "alice\nbob", true},
		{"carriage_return", "alice\rbob", true},
		{"escape", "alice\x1bbob", true},
		{"delete", "alice\x7fbob", true},

		// Unicode — allowed (non-control, non-backtick)
		{"unicode_cjk", "用户名", false},
		{"unicode_emoji", "alice🎯", false},
		{"unicode_rtl_override", "alic\u202ee", false},
		{"unicode_combining", "aliće", false},

		// Length stress
		{"oversized_safe_chars", strings.Repeat("a", 65536), false},
		{"oversized_with_backtick_at_end", strings.Repeat("a", 65535) + "`", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := quoteIdent(tc.in)
			if tc.mustError {
				if err == nil {
					t.Fatalf("quoteIdent(%q)=%q,nil; want non-nil err", tc.in, got)
				}
				if got != "" {
					t.Fatalf("quoteIdent(%q) on reject path returned non-empty %q", tc.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("quoteIdent(%q): unexpected err %v", tc.in, err)
			}
			// Framing invariant.
			if len(got) < 2 || got[0] != '`' || got[len(got)-1] != '`' {
				t.Fatalf("quoteIdent(%q)=%q missing backtick framing", tc.in, got)
			}
			// Body invariant: no backtick anywhere inside the quoted span.
			body := got[1 : len(got)-1]
			if strings.ContainsRune(body, '`') {
				t.Fatalf("quoteIdent(%q)=%q has interior backtick — escape gap", tc.in, got)
			}
			// Body equals the original input (identifier quoting does
			// not transform the byte sequence — it only frames it).
			if body != tc.in {
				t.Fatalf("quoteIdent(%q)=%q body=%q does not match input verbatim", tc.in, got, body)
			}
		})
	}
}
