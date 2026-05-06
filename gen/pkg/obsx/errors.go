package obsx

import "errors"

// ErrInvalidConfig is returned when obsx receives an invalid configuration.
var (
	ErrInvalidConfig = errors.New("ErrInvalidConfig")
)
