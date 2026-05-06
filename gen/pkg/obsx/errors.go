package obsx

import "errors"

// ErrInvalidConfig is returned when obsx receives an invalid
// configuration. Kept at package level per repo conventions; message uses
// a lowercase, package-prefixed, diagnostic form so log output reads
// naturally.
var (
	ErrInvalidConfig = errors.New("obsx: invalid configuration")
)
