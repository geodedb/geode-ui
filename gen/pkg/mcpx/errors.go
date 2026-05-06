package mcpx

import "errors"

// Sentinel errors for MCP runtime. Kept at package level per repo
// conventions. Messages use a lowercase, package-prefixed, diagnostic
// form so log output reads naturally; errors.Is callers should rely on
// pointer equality rather than substring matching of Error().
var (
	ErrInvalidConfig = errors.New("mcpx: invalid configuration")
	ErrAuthFailed    = errors.New("mcpx: authentication failed")
)
