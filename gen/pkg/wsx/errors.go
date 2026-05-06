package wsx

import "errors"

// Sentinel errors for WebSocket runtime. Kept at package level per repo conventions.
var (
	ErrFrameTooLarge = errors.New("ErrFrameTooLarge")
	ErrInvalidOpcode = errors.New("ErrInvalidOpcode")
	ErrInvalidConfig = errors.New("ErrInvalidConfig")
	ErrAuthFailed    = errors.New("ErrAuthFailed")
)
