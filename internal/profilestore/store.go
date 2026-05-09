package profilestore

import (
	"context"

	"geodedb.com/geode-ui/internal/conn"
)

// Filter narrows a List query. Empty fields disable that constraint;
// Scope="" returns both system and personal. OwnerUserID is only
// consulted when Scope=personal — system profiles ignore it because
// they are unowned by definition.
type Filter struct {
	Scope       conn.ProfileScope
	OwnerUserID string
}

// Store persists conn.Profile records. Implementations MUST be safe
// for concurrent use.
type Store interface {
	Get(ctx context.Context, id string) (conn.Profile, error)
	List(ctx context.Context, f Filter) ([]conn.Profile, error)
	// Put creates a new profile. p.ID may be empty; Put assigns a
	// random ID. Returns the persisted profile (with ID populated).
	Put(ctx context.Context, p conn.Profile) (conn.Profile, error)
	// Patch updates the profile at id with the supplied non-zero
	// fields. Scope and OwnerUserID are immutable; supplying a
	// different value returns ErrImmutable.
	Patch(ctx context.Context, id string, p conn.Profile) (conn.Profile, error)
	Delete(ctx context.Context, id string) error
	Close() error
}
