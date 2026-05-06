package securex

import "errors"

// Sentinel errors for security and auth. Kept at package level per repo conventions.
var (
	ErrInvalidConfig    = errors.New("ErrInvalidConfig")
	ErrAuthFailed       = errors.New("ErrAuthFailed")
	ErrRateLimited      = errors.New("ErrRateLimited")
	ErrInsufficientRole = errors.New("ErrInsufficientRole")
)
