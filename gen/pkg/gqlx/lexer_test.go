package gqlx

import (
	"testing"
)

func TestLexSimpleQuery(t *testing.T) {
	input := `{ hero { name } }`
	tokens, err := Lex(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := []struct {
		kind  TokenKind
		value string
	}{
		{TokLBrace, "{"},
		{TokName, "hero"},
		{TokLBrace, "{"},
		{TokName, "name"},
		{TokRBrace, "}"},
		{TokRBrace, "}"},
		{TokEOF, ""},
	}

	if len(tokens) != len(expected) {
		t.Fatalf("expected %d tokens, got %d: %v", len(expected), len(tokens), tokens)
	}

	for i, exp := range expected {
		tok := tokens[i]
		if tok.Kind != exp.kind {
			t.Errorf("token[%d] kind: got %v, want %v", i, tok.Kind, exp.kind)
		}
		if tok.Value != exp.value {
			t.Errorf("token[%d] value: got %q, want %q", i, tok.Value, exp.value)
		}
	}
}

func TestLexQueryWithArgs(t *testing.T) {
	input := `query Hero($id: ID!) { hero(id: $id) { name age } }`
	tokens, err := Lex(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Expect at least 10 tokens (not counting EOF).
	if len(tokens) < 10 {
		t.Fatalf("expected at least 10 tokens, got %d", len(tokens))
	}

	// Verify specific key tokens.
	expected := []struct {
		kind  TokenKind
		value string
	}{
		{TokName, "query"},
		{TokName, "Hero"},
		{TokLParen, "("},
		{TokDollar, "$"},
		{TokName, "id"},
		{TokColon, ":"},
		{TokName, "ID"},
		{TokBang, "!"},
		{TokRParen, ")"},
		{TokLBrace, "{"},
		{TokName, "hero"},
		{TokLParen, "("},
		{TokName, "id"},
		{TokColon, ":"},
		{TokDollar, "$"},
		{TokName, "id"},
		{TokRParen, ")"},
		{TokLBrace, "{"},
		{TokName, "name"},
		{TokName, "age"},
		{TokRBrace, "}"},
		{TokRBrace, "}"},
		{TokEOF, ""},
	}

	if len(tokens) != len(expected) {
		t.Fatalf("expected %d tokens, got %d: %v", len(expected), len(tokens), tokens)
	}

	for i, exp := range expected {
		tok := tokens[i]
		if tok.Kind != exp.kind {
			t.Errorf("token[%d] kind: got %v, want %v", i, tok.Kind, exp.kind)
		}
		if tok.Value != exp.value {
			t.Errorf("token[%d] value: got %q, want %q", i, tok.Value, exp.value)
		}
	}
}

func TestLexString(t *testing.T) {
	input := `{ field(arg: "hello world") }`
	tokens, err := Lex(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	found := false
	for _, tok := range tokens {
		if tok.Kind == TokString && tok.Value == "hello world" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected string token with value %q, tokens: %v", "hello world", tokens)
	}
}

func TestLexIntegers(t *testing.T) {
	input := `{ field(a: 42, b: -7) }`
	tokens, err := Lex(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var ints []string
	for _, tok := range tokens {
		if tok.Kind == TokInt {
			ints = append(ints, tok.Value)
		}
	}
	if len(ints) != 2 {
		t.Fatalf("expected 2 int tokens, got %d: %v", len(ints), ints)
	}
	if ints[0] != "42" {
		t.Errorf("first int: got %q, want %q", ints[0], "42")
	}
	if ints[1] != "-7" {
		t.Errorf("second int: got %q, want %q", ints[1], "-7")
	}
}

func TestLexFloat(t *testing.T) {
	input := `{ field(a: 3.14) }`
	tokens, err := Lex(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	found := false
	for _, tok := range tokens {
		if tok.Kind == TokFloat && tok.Value == "3.14" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected float token with value %q, tokens: %v", "3.14", tokens)
	}
}

func TestLexBlockString(t *testing.T) {
	input := "{ field(a: \"\"\"block\nstring\"\"\") }"
	tokens, err := Lex(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	found := false
	for _, tok := range tokens {
		if tok.Kind == TokString && tok.Value == "block\nstring" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected block string token with value %q, tokens: %v", "block\nstring", tokens)
	}
}

func TestLexSpread(t *testing.T) {
	input := `{ ...frag }`
	tokens, err := Lex(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	found := false
	for _, tok := range tokens {
		if tok.Kind == TokSpread {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected spread token, tokens: %v", tokens)
	}
}

func TestLexComment(t *testing.T) {
	input := "# comment\n{ field }"
	tokens, err := Lex(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Comment should be skipped entirely.
	for _, tok := range tokens {
		if tok.Value == "comment" || tok.Value == "# comment" {
			t.Fatalf("comment was not skipped: %v", tokens)
		}
	}

	// Should produce: LBrace, Name("field"), RBrace, EOF.
	expected := []struct {
		kind  TokenKind
		value string
	}{
		{TokLBrace, "{"},
		{TokName, "field"},
		{TokRBrace, "}"},
		{TokEOF, ""},
	}

	if len(tokens) != len(expected) {
		t.Fatalf("expected %d tokens, got %d: %v", len(expected), len(tokens), tokens)
	}

	for i, exp := range expected {
		tok := tokens[i]
		if tok.Kind != exp.kind || tok.Value != exp.value {
			t.Errorf("token[%d]: got (%v, %q), want (%v, %q)", i, tok.Kind, tok.Value, exp.kind, exp.value)
		}
	}
}

func TestLexUnterminatedString(t *testing.T) {
	input := `{ field(a: "unterminated) }`
	_, err := Lex(input)
	if err == nil {
		t.Fatalf("expected error for unterminated string")
	}
}

func TestLexInvalidChar(t *testing.T) {
	input := "{ field\x00 }"
	_, err := Lex(input)
	if err == nil {
		t.Fatalf("expected error for invalid NUL character")
	}
}

// TestLexLineCol verifies that line and column tracking is correct.
func TestLexLineCol(t *testing.T) {
	input := "{\n  name\n}"
	tokens, err := Lex(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Token 0: '{' at line 1, col 1
	if tokens[0].Line != 1 || tokens[0].Col != 1 {
		t.Errorf("token[0] pos: got (%d,%d), want (1,1)", tokens[0].Line, tokens[0].Col)
	}
	// Token 1: 'name' at line 2, col 3
	if tokens[1].Line != 2 || tokens[1].Col != 3 {
		t.Errorf("token[1] pos: got (%d,%d), want (2,3)", tokens[1].Line, tokens[1].Col)
	}
	// Token 2: '}' at line 3, col 1
	if tokens[2].Line != 3 || tokens[2].Col != 1 {
		t.Errorf("token[2] pos: got (%d,%d), want (3,1)", tokens[2].Line, tokens[2].Col)
	}
}

// TestLexStringEscapes verifies that escape sequences are handled.
func TestLexStringEscapes(t *testing.T) {
	input := `{ field(a: "hello\nworld\t\"quoted\"") }`
	tokens, err := Lex(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	found := false
	for _, tok := range tokens {
		if tok.Kind == TokString && tok.Value == "hello\nworld\t\"quoted\"" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected string token with escape sequences resolved")
	}
}

// TestLexUnicodeEscape verifies \uXXXX handling.
func TestLexUnicodeEscape(t *testing.T) {
	input := `{ field(a: "\u0041\u0042") }`
	tokens, err := Lex(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	found := false
	for _, tok := range tokens {
		if tok.Kind == TokString && tok.Value == "AB" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected string token with unicode escapes resolved to \"AB\"")
	}
}

// TestLexFloatExponent verifies scientific notation.
func TestLexFloatExponent(t *testing.T) {
	input := `{ field(a: 1.5e10, b: 2E-3) }`
	tokens, err := Lex(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var floats []string
	for _, tok := range tokens {
		if tok.Kind == TokFloat {
			floats = append(floats, tok.Value)
		}
	}
	if len(floats) != 2 {
		t.Fatalf("expected 2 float tokens, got %d: %v", len(floats), floats)
	}
	if floats[0] != "1.5e10" {
		t.Errorf("first float: got %q, want %q", floats[0], "1.5e10")
	}
	if floats[1] != "2E-3" {
		t.Errorf("second float: got %q, want %q", floats[1], "2E-3")
	}
}

// TestLexPipe verifies the pipe punctuator.
func TestLexPipe(t *testing.T) {
	input := `union SearchResult = Human | Droid`
	tokens, err := Lex(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	found := false
	for _, tok := range tokens {
		if tok.Kind == TokPipe {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected pipe token, tokens: %v", tokens)
	}
}

// TestLexBlockStringIndentStripping verifies common indent removal.
// Per the GraphQL spec BlockStringValue algorithm:
// 1. Split raw value into lines.
// 2. Common indent = min indent of non-blank lines after the first.
// 3. Remove common indent from all lines except the first.
// 4. Strip leading and trailing blank lines.
func TestLexBlockStringIndentStripping(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name: "uniform indent",
			// Raw lines: ["", "    hello", "    world", "  "]
			// Non-blank after first: "    hello" (4), "    world" (4) → common=4
			// After strip: ["hello", "world"]
			input: "{ field(a: \"\"\"\n    hello\n    world\n  \"\"\") }",
			want:  "hello\nworld",
		},
		{
			name: "mixed indent",
			// Raw lines: ["", "    hello", "  world", "  "]
			// Non-blank after first: "    hello" (4), "  world" (2) → common=2
			// After strip: ["  hello", "world"]
			input: "{ field(a: \"\"\"\n    hello\n  world\n  \"\"\") }",
			want:  "  hello\nworld",
		},
		{
			name: "no indent",
			// Raw lines: ["", "hello", "world", ""]
			// Non-blank after first: "hello" (0), "world" (0) → common=0
			// After strip: ["hello", "world"]
			input: "{ field(a: \"\"\"\nhello\nworld\n\"\"\") }",
			want:  "hello\nworld",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tokens, err := Lex(tt.input)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			found := false
			for _, tok := range tokens {
				if tok.Kind == TokString && tok.Value == tt.want {
					found = true
					break
				}
			}
			if !found {
				for _, tok := range tokens {
					if tok.Kind == TokString {
						t.Logf("got string value: %q", tok.Value)
					}
				}
				t.Fatalf("expected block string to produce %q", tt.want)
			}
		})
	}
}

// TestLexEmpty verifies lexing an empty string.
func TestLexEmpty(t *testing.T) {
	tokens, err := Lex("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(tokens) != 1 || tokens[0].Kind != TokEOF {
		t.Fatalf("expected single EOF token, got %v", tokens)
	}
}

// TestLexBOM verifies that a BOM character at the start is skipped.
func TestLexBOM(t *testing.T) {
	input := "\xEF\xBB\xBF{ name }"
	tokens, err := Lex(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if tokens[0].Kind != TokLBrace {
		t.Fatalf("expected first token to be LBrace after BOM, got %v", tokens[0])
	}
}

// TestLexUnterminatedBlockString verifies error on unterminated block string.
func TestLexUnterminatedBlockString(t *testing.T) {
	input := `{ field(a: """unterminated block) }`
	_, err := Lex(input)
	if err == nil {
		t.Fatalf("expected error for unterminated block string")
	}
}

// TestLexNegativeFloat verifies negative floats.
func TestLexNegativeFloat(t *testing.T) {
	input := `{ field(a: -3.14) }`
	tokens, err := Lex(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	found := false
	for _, tok := range tokens {
		if tok.Kind == TokFloat && tok.Value == "-3.14" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected float token %q", "-3.14")
	}
}
