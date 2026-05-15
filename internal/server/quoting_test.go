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
// single-quoted form of `raw`: backslashes escaped FIRST (\ -> \\),
// then internal single quotes doubled (a single quote -> two single
// quotes). We rebuild the expected representation locally so the test
// does not depend on the helper's own escape pass. The backslash-first
// ordering mirrors the authoritative geode-client-go gqlStringEscaper
// (conn.go): GQL supports both doubled-quote and backslash-quote
// escaping, so a literal backslash must be neutralised before any
// quote-doubling pass runs.
func canonicalQuoteString(raw string) string {
	s := strings.ReplaceAll(raw, `\`, `\\`)
	s = strings.ReplaceAll(s, "'", "''")
	return "'" + s + "'"
}

func quoteStringRoundTrips(raw, quoted string) bool {
	return quoted == canonicalQuoteString(raw)
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

// TestQuoteString_BackslashEscape (F-INPUT-1, #140): GQL accepts both
// a doubled single quote and a backslash-escaped single quote inside a
// single-quoted literal. A naive quoter that only doubles single quotes
// leaves a literal backslash untouched, so a payload of backslash+quote
// becomes quote, backslash, quote, quote -- which the GQL parser reads
// as a backslash-escaped quote followed by an UNescaped quote, breaking
// out of the literal. The fix escapes the backslash FIRST (\ -> \\)
// then doubles single quotes, matching the authoritative geode-client-go
// gqlStringEscaper.
func TestQuoteString_BackslashEscape(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"single_backslash_in_middle", `a\b`, `'a\\b'`},
		{"backslash_quote", `\'`, `'\\'''`},
		{"double_backslash", `\\`, `'\\\\'`},
		{"trailing_backslash", `abc\`, `'abc\\'`},
		{"leading_backslash", `\abc`, `'\\abc'`},
		{"backslash_then_doubled_quote_payload", `alice\' OR 1=1 --`, `'alice\\'' OR 1=1 --'`},
		{"only_backslashes", `\\\`, `'\\\\\\'`},
		{"backslash_n_literal_not_control", `a\nb`, `'a\\nb'`}, // literal backslash + 'n', NOT a newline byte
		{"no_backslash_unchanged", `alice'`, `'alice'''`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := quoteString(tc.in)
			if err != nil {
				t.Fatalf("quoteString(%q): unexpected err %v", tc.in, err)
			}
			if got != tc.want {
				t.Fatalf("quoteString(%q) = %q; want %q", tc.in, got, tc.want)
			}
			// Consistency with the canonical (client-go-mirrored) escaper.
			if got != canonicalQuoteString(tc.in) {
				t.Fatalf("quoteString(%q) = %q; canonical = %q (escaper drift)", tc.in, got, canonicalQuoteString(tc.in))
			}
		})
	}

	// Control chars containing a backslash byte are still rejected
	// outright (the backslash escape runs only on the accepted path).
	for _, in := range []string{"a\\\nb", "\\\x00", "\\\t"} {
		if got, err := quoteString(in); err == nil {
			t.Fatalf("quoteString(%q) = %q, nil; want non-nil err (control char)", in, got)
		}
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
// Geode v0.5.15 has no working delimited-identifier syntax in the
// lexer (scanQuotedIdentifier is dead code; `"x"` parses as a string
// literal, backticks parse as illegal). The only safe form is a bare
// identifier that already matches the upstream identifier shape:
//
//	[A-Za-z_] (then any of letter / digit / underscore / hyphen)
//
// quoteIdent therefore validates the input against that shape and
// returns it verbatim. Anything outside the shape is rejected at the
// handler boundary with a 400 invalid_<field> error before reaching
// the wire.
func TestQuoteIdent_Adversarial(t *testing.T) {
	cases := []struct {
		name      string
		in        string
		mustError bool
	}{
		// Plain identifiers — accepted.
		{"plain_alphanum", "alice", false},
		{"with_underscore", "alice_bob", false},
		{"with_hyphen", "alice-bob", false},
		{"with_digit_mid", "alice42", false},
		{"with_digit_start", "5oclock", false}, // digits at start allowed for migration names
		{"leading_underscore", "_underscored", false},

		// Delimiter / control / metacharacter shapes — rejected.
		{"dquote_injection_basic", `alice"; DROP USER "bob`, true},
		{"trailing_dquote", `alice"`, true},
		{"leading_dquote", `"alice`, true},
		{"backtick_injection_basic", "alice`; DROP USER `bob", true},
		{"trailing_backtick", "alice`", true},
		{"leading_backtick", "`alice", true},
		{"leading_hyphen_blocked", "-alice", true}, // option-confusion guard

		// Empty / whitespace
		{"empty_string_rejected", "", true},
		{"single_space_rejected", " ", true},
		{"space_inside_rejected", "with spaces", true},

		// Control characters — rejected wholesale.
		{"nul_byte", "alice\x00", true},
		{"tab", "alice\tbob", true},
		{"newline", "alice\nbob", true},
		{"carriage_return", "alice\rbob", true},
		{"escape", "alice\x1bbob", true},
		{"delete", "alice\x7fbob", true},

		// Punctuation — rejected (not in identifier shape).
		{"dot_rejected", "alice.bob", true},
		{"slash_rejected", "alice/bob", true},
		{"semicolon_rejected", "alice;bob", true},
		{"paren_rejected", "alice(bob)", true},

		// Unicode — rejected (multi-byte not in identifier shape).
		{"unicode_cjk", "用户名", true},
		{"unicode_emoji", "alice🎯", true},

		// Length — safe chars only.
		{"oversized_safe_chars", strings.Repeat("a", 65536), false},
		{"oversized_with_dquote_at_end", strings.Repeat("a", 65535) + `"`, true},
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
			// quoteIdent emits bare (no framing) — input must round-trip
			// byte-for-byte.
			if got != tc.in {
				t.Fatalf("quoteIdent(%q)=%q want verbatim", tc.in, got)
			}
		})
	}
}
