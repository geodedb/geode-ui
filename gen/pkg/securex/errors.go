package securex

import "errors"

// Sentinel errors for security and auth. Kept at package level per repo
// conventions. Messages use a lowercase, package-prefixed, diagnostic
// form so log output reads naturally; errors.Is callers should rely on
// pointer equality rather than substring matching of Error().
var (
	ErrInvalidConfig    = errors.New("securex: invalid configuration")
	ErrAuthFailed       = errors.New("securex: authentication failed")
	ErrRateLimited      = errors.New("securex: rate limit exceeded")
	ErrInsufficientRole = errors.New("securex: insufficient role")
	// ErrBodyTooLarge is returned by HMAC verification paths when a request
	// body exceeds the per-call limit. Streaming the body through sha256
	// via io.LimitReader prevents an attacker from forcing the server to
	// buffer arbitrarily large payloads to be signed. (PERF-0012.)
	ErrBodyTooLarge = errors.New("securex: request body exceeds signing limit")
)
