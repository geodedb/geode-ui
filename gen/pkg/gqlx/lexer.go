package gqlx

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// TokenKind classifies each token produced by the lexer.
type TokenKind int

const (
	TokEOF      TokenKind = iota // end of input
	TokName                      // identifier: [_A-Za-z][_0-9A-Za-z]*
	TokInt                       // integer literal
	TokFloat                     // float literal
	TokString                    // string or block string literal
	TokLBrace                    // {
	TokRBrace                    // }
	TokLParen                    // (
	TokRParen                    // )
	TokLBracket                  // [
	TokRBracket                  // ]
	TokColon                     // :
	TokBang                      // !
	TokDollar                    // $
	TokAt                        // @
	TokEquals                    // =
	TokSpread                    // ...
	TokPipe                      // |
)

// tokenNames maps each TokenKind to its display name for debugging.
var tokenNames = [...]string{
	TokEOF:      "EOF",
	TokName:     "Name",
	TokInt:      "Int",
	TokFloat:    "Float",
	TokString:   "String",
	TokLBrace:   "LBrace",
	TokRBrace:   "RBrace",
	TokLParen:   "LParen",
	TokRParen:   "RParen",
	TokLBracket: "LBracket",
	TokRBracket: "RBracket",
	TokColon:    "Colon",
	TokBang:     "Bang",
	TokDollar:   "Dollar",
	TokAt:       "At",
	TokEquals:   "Equals",
	TokSpread:   "Spread",
	TokPipe:     "Pipe",
}

// String returns the human-readable name for the token kind.
func (k TokenKind) String() string {
	if int(k) < len(tokenNames) {
		return tokenNames[k]
	}
	return fmt.Sprintf("TokenKind(%d)", k)
}

// Token represents a single lexical token from a GraphQL document.
type Token struct {
	Kind  TokenKind
	Value string
	Line  int
	Col   int
}

// String returns a debug representation of the token.
func (t Token) String() string {
	if t.Value == "" {
		return fmt.Sprintf("%s@%d:%d", t.Kind, t.Line, t.Col)
	}
	return fmt.Sprintf("%s(%q)@%d:%d", t.Kind, t.Value, t.Line, t.Col)
}

// lexer holds the state for scanning a GraphQL source string.
type lexer struct {
	src    string
	pos    int
	line   int
	col    int
	tokens []Token
}

// Lex tokenizes a GraphQL document string and returns the token slice.
// The final token is always TokEOF. Returns an error for malformed input.
func Lex(input string) ([]Token, error) {
	l := &lexer{
		src:  input,
		line: 1,
		col:  1,
	}
	if err := l.scan(); err != nil {
		return nil, err
	}
	return l.tokens, nil
}

// scan runs the main lexer loop.
func (l *lexer) scan() error {
	for {
		l.skipIgnored()
		if l.pos >= len(l.src) {
			l.emit(TokEOF, "")
			return nil
		}

		ch := l.src[l.pos]

		// Reject NUL bytes and other non-printable ASCII control characters
		// (except tab 0x09, newline 0x0A, carriage return 0x0D).
		if ch < 0x20 && ch != '\t' && ch != '\n' && ch != '\r' {
			return l.errorf("unexpected character U+%04X", ch)
		}

		switch ch {
		case '{':
			l.emitAdvance(TokLBrace, "{", 1)
		case '}':
			l.emitAdvance(TokRBrace, "}", 1)
		case '(':
			l.emitAdvance(TokLParen, "(", 1)
		case ')':
			l.emitAdvance(TokRParen, ")", 1)
		case '[':
			l.emitAdvance(TokLBracket, "[", 1)
		case ']':
			l.emitAdvance(TokRBracket, "]", 1)
		case ':':
			l.emitAdvance(TokColon, ":", 1)
		case '!':
			l.emitAdvance(TokBang, "!", 1)
		case '$':
			l.emitAdvance(TokDollar, "$", 1)
		case '@':
			l.emitAdvance(TokAt, "@", 1)
		case '=':
			l.emitAdvance(TokEquals, "=", 1)
		case '|':
			l.emitAdvance(TokPipe, "|", 1)
		case '.':
			if l.pos+2 < len(l.src) && l.src[l.pos+1] == '.' && l.src[l.pos+2] == '.' {
				l.emitAdvance(TokSpread, "...", 3)
			} else {
				return l.errorf("unexpected character '.'")
			}
		case '"':
			if err := l.readString(); err != nil {
				return err
			}
		case '-':
			if err := l.readNumber(); err != nil {
				return err
			}
		default:
			switch {
			case isDigit(ch):
				if err := l.readNumber(); err != nil {
					return err
				}
			case isNameStart(ch):
				l.readName()
			default:
				// Could be a multi-byte rune or truly invalid.
				r, size := utf8.DecodeRuneInString(l.src[l.pos:])
				if r == utf8.RuneError && size <= 1 {
					return l.errorf("invalid byte 0x%02X", ch)
				}
				return l.errorf("unexpected character U+%04X %q", r, string(r))
			}
		}
	}
}

// skipIgnored skips whitespace, commas, BOM, and line comments.
// Per the GraphQL spec, the "ignored" tokens are: whitespace, line terminators,
// commas, comments, and the Unicode BOM (U+FEFF).
func (l *lexer) skipIgnored() {
	for l.pos < len(l.src) {
		ch := l.src[l.pos]
		switch ch {
		case ' ', '\t', ',':
			l.advance(1)
		case '\n':
			l.pos++
			l.line++
			l.col = 1
		case '\r':
			l.pos++
			if l.pos < len(l.src) && l.src[l.pos] == '\n' {
				l.pos++
			}
			l.line++
			l.col = 1
		case '#':
			// Line comment: skip to end of line.
			l.pos++
			l.col++
			for l.pos < len(l.src) && l.src[l.pos] != '\n' && l.src[l.pos] != '\r' {
				l.pos++
				l.col++
			}
		default:
			// Check for UTF-8 BOM (U+FEFF) which is 0xEF 0xBB 0xBF in UTF-8.
			if ch == 0xEF && l.pos+2 < len(l.src) && l.src[l.pos+1] == 0xBB && l.src[l.pos+2] == 0xBF {
				l.advance(3)
				continue
			}
			return
		}
	}
}

// readName reads a Name token: [_A-Za-z][_0-9A-Za-z]*.
func (l *lexer) readName() {
	start := l.pos
	startLine := l.line
	startCol := l.col
	l.advance(1) // consume first character (already validated as nameStart)
	for l.pos < len(l.src) && isNameContinue(l.src[l.pos]) {
		l.advance(1)
	}
	l.tokens = append(l.tokens, Token{
		Kind:  TokName,
		Value: l.src[start:l.pos],
		Line:  startLine,
		Col:   startCol,
	})
}

// readNumber reads an integer or float literal.
// Grammar:
//
//	IntValue  = IntegerPart
//	FloatValue = IntegerPart FractionalPart? ExponentPart?
//	           (must have at least FractionalPart or ExponentPart)
//	IntegerPart = NegativeSign? (0 | NonZeroDigit Digit*)
func (l *lexer) readNumber() error {
	start := l.pos
	startLine := l.line
	startCol := l.col
	isFloat := false

	// Optional leading negative sign.
	if l.pos < len(l.src) && l.src[l.pos] == '-' {
		l.advance(1)
	}

	// Integer part: must have at least one digit.
	if l.pos >= len(l.src) || !isDigit(l.src[l.pos]) {
		return l.errorf("invalid number: expected digit after '-'")
	}

	// If first digit is 0, integer part is just "0" (no leading zeros).
	if l.src[l.pos] == '0' {
		l.advance(1)
	} else {
		for l.pos < len(l.src) && isDigit(l.src[l.pos]) {
			l.advance(1)
		}
	}

	// Optional fractional part.
	if l.pos < len(l.src) && l.src[l.pos] == '.' {
		isFloat = true
		l.advance(1) // consume '.'
		if l.pos >= len(l.src) || !isDigit(l.src[l.pos]) {
			return l.errorf("invalid number: expected digit after '.'")
		}
		for l.pos < len(l.src) && isDigit(l.src[l.pos]) {
			l.advance(1)
		}
	}

	// Optional exponent part.
	if l.pos < len(l.src) && (l.src[l.pos] == 'e' || l.src[l.pos] == 'E') {
		isFloat = true
		l.advance(1) // consume 'e'/'E'
		if l.pos < len(l.src) && (l.src[l.pos] == '+' || l.src[l.pos] == '-') {
			l.advance(1) // consume sign
		}
		if l.pos >= len(l.src) || !isDigit(l.src[l.pos]) {
			return l.errorf("invalid number: expected digit in exponent")
		}
		for l.pos < len(l.src) && isDigit(l.src[l.pos]) {
			l.advance(1)
		}
	}

	kind := TokInt
	if isFloat {
		kind = TokFloat
	}

	l.tokens = append(l.tokens, Token{
		Kind:  kind,
		Value: l.src[start:l.pos],
		Line:  startLine,
		Col:   startCol,
	})
	return nil
}

// readString reads a regular string or a block string.
func (l *lexer) readString() error {
	// Check for block string: """
	if l.pos+2 < len(l.src) && l.src[l.pos+1] == '"' && l.src[l.pos+2] == '"' {
		return l.readBlockString()
	}
	return l.readSingleString()
}

// readSingleString reads a "..." string with escape handling.
func (l *lexer) readSingleString() error {
	startLine := l.line
	startCol := l.col
	l.advance(1) // skip opening '"'

	var b strings.Builder
	for {
		if l.pos >= len(l.src) {
			return fmt.Errorf("unterminated string at %d:%d", startLine, startCol)
		}
		ch := l.src[l.pos]
		if ch == '\n' || ch == '\r' {
			return fmt.Errorf("unterminated string at %d:%d", startLine, startCol)
		}
		if ch == '"' {
			l.advance(1) // skip closing '"'
			l.tokens = append(l.tokens, Token{
				Kind:  TokString,
				Value: b.String(),
				Line:  startLine,
				Col:   startCol,
			})
			return nil
		}
		if ch == '\\' {
			r, n, err := l.readEscape()
			if err != nil {
				return err
			}
			b.WriteRune(r)
			l.advance(n)
			continue
		}
		b.WriteByte(ch)
		l.advance(1)
	}
}

// readEscape reads an escape sequence starting at l.pos (which points at '\').
// Returns the decoded rune, the number of bytes consumed, and any error.
func (l *lexer) readEscape() (rune, int, error) {
	if l.pos+1 >= len(l.src) {
		return 0, 0, fmt.Errorf("unterminated escape at %d:%d", l.line, l.col)
	}
	ch := l.src[l.pos+1]
	switch ch {
	case '"':
		return '"', 2, nil
	case '\\':
		return '\\', 2, nil
	case '/':
		return '/', 2, nil
	case 'b':
		return '\b', 2, nil
	case 'f':
		return '\f', 2, nil
	case 'n':
		return '\n', 2, nil
	case 'r':
		return '\r', 2, nil
	case 't':
		return '\t', 2, nil
	case 'u':
		// \uXXXX
		if l.pos+5 >= len(l.src) {
			return 0, 0, fmt.Errorf("invalid unicode escape at %d:%d", l.line, l.col)
		}
		hex := l.src[l.pos+2 : l.pos+6]
		r, err := parseHex4(hex)
		if err != nil {
			return 0, 0, fmt.Errorf("invalid unicode escape %q at %d:%d", hex, l.line, l.col)
		}
		return r, 6, nil
	default:
		return 0, 0, fmt.Errorf("invalid escape character %q at %d:%d", ch, l.line, l.col)
	}
}

// parseHex4 parses a 4-character hex string into a rune.
func parseHex4(s string) (rune, error) {
	if len(s) != 4 {
		return 0, fmt.Errorf("expected 4 hex digits, got %d", len(s))
	}
	var val rune
	for _, c := range s {
		val <<= 4
		switch {
		case c >= '0' && c <= '9':
			val |= c - '0'
		case c >= 'a' && c <= 'f':
			val |= c - 'a' + 10
		case c >= 'A' && c <= 'F':
			val |= c - 'A' + 10
		default:
			return 0, fmt.Errorf("invalid hex digit %q", c)
		}
	}
	return val, nil
}

// readBlockString reads a """...""" block string with indent stripping.
func (l *lexer) readBlockString() error {
	startLine := l.line
	startCol := l.col
	l.advance(3) // skip opening """

	var b strings.Builder
	for {
		if l.pos >= len(l.src) {
			return fmt.Errorf("unterminated block string at %d:%d", startLine, startCol)
		}

		ch := l.src[l.pos]

		// Check for closing """
		if ch == '"' && l.pos+2 < len(l.src) && l.src[l.pos+1] == '"' && l.src[l.pos+2] == '"' {
			l.advance(3) // skip closing """
			value := blockStringValue(b.String())
			l.tokens = append(l.tokens, Token{
				Kind:  TokString,
				Value: value,
				Line:  startLine,
				Col:   startCol,
			})
			return nil
		}

		// Handle escaped triple-quote: \"""
		if ch == '\\' && l.pos+3 < len(l.src) && l.src[l.pos+1] == '"' && l.src[l.pos+2] == '"' && l.src[l.pos+3] == '"' {
			b.WriteString(`"""`)
			l.advance(4)
			continue
		}

		// Track newlines within block strings.
		if ch == '\n' {
			b.WriteByte('\n')
			l.pos++
			l.line++
			l.col = 1
			continue
		}
		if ch == '\r' {
			b.WriteByte('\n')
			l.pos++
			if l.pos < len(l.src) && l.src[l.pos] == '\n' {
				l.pos++
			}
			l.line++
			l.col = 1
			continue
		}

		b.WriteByte(ch)
		l.advance(1)
	}
}

// blockStringValue applies the GraphQL block string value algorithm:
// 1. Split into lines.
// 2. Find common indent (excluding the first line and blank lines).
// 3. Remove common indent from all lines except the first.
// 4. Strip leading and trailing blank lines.
func blockStringValue(raw string) string {
	lines := strings.Split(raw, "\n")

	// Determine common indent.
	commonIndent := -1
	for i := 1; i < len(lines); i++ {
		indent := leadingWhitespace(lines[i])
		if indent < len(lines[i]) { // non-blank line
			if commonIndent < 0 || indent < commonIndent {
				commonIndent = indent
			}
		}
	}

	// Remove common indent from lines after the first.
	if commonIndent > 0 {
		for i := 1; i < len(lines); i++ {
			if len(lines[i]) >= commonIndent {
				lines[i] = lines[i][commonIndent:]
			}
		}
	}

	// Strip leading blank lines.
	for len(lines) > 0 && isBlank(lines[0]) {
		lines = lines[1:]
	}

	// Strip trailing blank lines.
	for len(lines) > 0 && isBlank(lines[len(lines)-1]) {
		lines = lines[:len(lines)-1]
	}

	return strings.Join(lines, "\n")
}

// leadingWhitespace returns the number of leading space/tab characters.
func leadingWhitespace(s string) int {
	n := 0
	for _, ch := range s {
		if ch == ' ' || ch == '\t' {
			n++
		} else {
			break
		}
	}
	return n
}

// isBlank returns true if the string contains only whitespace.
func isBlank(s string) bool {
	for _, ch := range s {
		if ch != ' ' && ch != '\t' {
			return false
		}
	}
	return true
}

// emit appends a token at the current position.
func (l *lexer) emit(kind TokenKind, value string) {
	l.tokens = append(l.tokens, Token{
		Kind:  kind,
		Value: value,
		Line:  l.line,
		Col:   l.col,
	})
}

// emitAdvance emits a token and advances by n bytes.
func (l *lexer) emitAdvance(kind TokenKind, value string, n int) {
	l.emit(kind, value)
	l.advance(n)
}

// advance moves the position forward by n bytes, updating col.
func (l *lexer) advance(n int) {
	l.pos += n
	l.col += n
}

// errorf returns a formatted error at the current position.
func (l *lexer) errorf(format string, args ...any) error {
	prefix := fmt.Sprintf("lexer error at %d:%d: ", l.line, l.col)
	return fmt.Errorf(prefix+format, args...)
}

// isDigit returns true for ASCII decimal digits.
func isDigit(ch byte) bool {
	return ch >= '0' && ch <= '9'
}

// isNameStart returns true for characters that can start a GraphQL Name.
func isNameStart(ch byte) bool {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch == '_'
}

// isNameContinue returns true for characters that can continue a GraphQL Name.
func isNameContinue(ch byte) bool {
	return isNameStart(ch) || isDigit(ch)
}
