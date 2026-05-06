package mcpx

import "errors"

// Sentinel errors for MCP runtime. Kept at package level per repo conventions.
var (
	ErrInvalidConfig = errors.New("ErrInvalidConfig")
	ErrAuthFailed    = errors.New("ErrAuthFailed")
)
