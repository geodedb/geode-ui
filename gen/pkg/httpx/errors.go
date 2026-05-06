package httpx

import "errors"

// Sentinel errors for HTTP runtime. Kept at package level per repo conventions.
var (
	ErrInvalidConfig = errors.New("ErrInvalidConfig")
	ErrAuthFailed    = errors.New("ErrAuthFailed")
	ErrRateLimited   = errors.New("ErrRateLimited")
	ErrBodyTooLarge  = errors.New("ErrBodyTooLarge")
)
