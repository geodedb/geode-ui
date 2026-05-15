package profilestore

import "errors"

var (
	ErrNotFound  = errors.New("profilestore: profile not found")
	ErrConflict  = errors.New("profilestore: profile name conflict in scope")
	ErrImmutable = errors.New("profilestore: scope and owner are immutable")
	ErrInvalid   = errors.New("profilestore: profile failed validation")
)
