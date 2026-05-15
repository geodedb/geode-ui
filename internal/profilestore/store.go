package profilestore

import (
	"context"

	"geodedb.com/geode-ui/internal/conn"
)

// Filter narrows a List query. Empty fields disable that constraint;
// Scope="" returns both system and personal. OwnerUserID is only
// consulted when Scope=personal — system profiles ignore it because
// they are unowned by definition.
//
// PSR-F3 (#99): Limit caps the number of rows returned in a single
// call; the zero value means "no limit" so the legacy default
// behaviour is preserved for callers that haven't migrated. AfterID is
// the cursor pagination cursor — when non-empty, only rows with
// `id > AfterID` are returned. Combined with the rows being ordered by
// `id ASC`, this provides stable forward pagination without needing
// OFFSET (which would cost a full table scan up to the offset).
//
// To page through a large catalogue:
//
//	cursor := ""
//	for {
//	    page, _ := store.List(ctx, Filter{Limit: 100, AfterID: cursor})
//	    if len(page) == 0 { break }
//	    handle(page)
//	    cursor = page[len(page)-1].ID
//	}
//
// Implementations MUST surface rows in `id ASC` order whenever Limit
// or AfterID is non-zero so the cursor advances deterministically. In
// the unbounded "Limit==0 && AfterID==”" case the historical
// (scope ASC, name ASC) ordering is preserved for backwards
// compatibility with the existing reload path.
type Filter struct {
	Scope       conn.ProfileScope
	OwnerUserID string
	// Limit caps the result set; 0 means unbounded.
	Limit int
	// AfterID is the cursor: when non-empty, only rows whose id is
	// lexicographically greater than AfterID are returned. Pass the
	// last row's ID from the previous page to advance.
	AfterID string
}

// DefaultListLimit is the page size that handlers SHOULD apply when a
// caller does not supply an explicit limit. 100 is large enough to
// hold the SPA's full-catalogue render in a single response for the
// vast majority of installations, and small enough to put a hard cap
// on memory + JSON encoding cost when the catalogue grows past that
// point.
//
// The List method itself defaults to unlimited (Filter.Limit == 0)
// to keep the reload-pool fast path one round-trip; the cap is
// applied at the HTTP boundary where unbounded responses would be a
// liability.
const DefaultListLimit = 100

// ProfilePatch is the partial-update payload accepted by Store.Patch.
//
// The pointer-typed optionals carry the "set vs absent" distinction
// that PATCH requires: a nil field leaves the persisted value alone,
// while a non-nil field overwrites it -- including with the field
// type's zero value. This is the only way PATCH can clear a
// previously-set Description, SavedUsername, TLS bundle, or pool
// override (PSR-G02).
//
// The Scope and OwnerUserID immutables intentionally stay off this
// type: a partial update may not move a profile across scopes or
// owners. Callers that try to do so via the legacy paths get
// ErrImmutable from the store.
type ProfilePatch struct {
	Name          *string             `json:"name,omitempty"`
	DSN           *string             `json:"dsn,omitempty"`
	Description   *string             `json:"description,omitempty"`
	SavedUsername *string             `json:"saved_username,omitempty"`
	Default       *bool               `json:"is_default,omitempty"`
	TLS           *conn.TLSMaterial   `json:"tls,omitempty"`
	PoolOverrides *conn.PoolOverrides `json:"pool_overrides,omitempty"`
}

// Store persists conn.Profile records. Implementations MUST be safe
// for concurrent use.
type Store interface {
	Get(ctx context.Context, id string) (conn.Profile, error)
	List(ctx context.Context, f Filter) ([]conn.Profile, error)
	// ListVisible returns the union of system profiles and the
	// personal profiles owned by ownerUserID, computed in a single
	// SQL round-trip. This is the GET /profiles fast path
	// (PSR-F4 / #101): the previous implementation issued two
	// sequential List queries (one filtered to scope=system, one
	// filtered to scope=personal+owner) and concatenated the results
	// in Go. ListVisible collapses both into a single query whose
	// WHERE clause expresses `scope='system' OR (scope='personal'
	// AND owner_user_id=?)`. Ordering matches List
	// (scope ASC, name ASC) so callers see a stable shape.
	//
	// An empty ownerUserID is honoured (only system profiles are
	// returned) so the legacy "no authenticated subject" path stays
	// well-defined.
	ListVisible(ctx context.Context, ownerUserID string) ([]conn.Profile, error)
	// Put creates a new profile. p.ID may be empty; Put assigns a
	// random ID. Returns the persisted profile (with ID populated).
	Put(ctx context.Context, p conn.Profile) (conn.Profile, error)
	// Patch applies the supplied ProfilePatch to the profile at id.
	// nil fields preserve the current persisted value; non-nil
	// fields overwrite it (including with zero values, which is the
	// only way PATCH can clear TLS material or pool overrides).
	// Scope and OwnerUserID are immutable.
	Patch(ctx context.Context, id string, p ProfilePatch) (conn.Profile, error)
	Delete(ctx context.Context, id string) error
	Close() error
}
