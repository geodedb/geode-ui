package server

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"net/http"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"
)

// PSR-F4 / #101: GetProfiles previously issued two sequential
// Store.List calls (system, then personal+owner) and concatenated the
// results in Go. Under SetMaxOpenConns(1) the second always blocked
// behind the first. The handler now issues a single
// Store.ListVisible call that expresses the union in one SQL query.

// GetProfiles implements GET /api/v1/profiles. Behaviour:
//
//   - When Config.Store is set, returns the union of system profiles
//     plus the caller's personal profiles. Sensitive fields (DSN, TLS,
//     pool_overrides, saved_username) are zeroed out in the response
//     unless the caller is admin OR is the owner of the personal
//     profile.
//   - When Config.Store is nil, falls back to enumerating profile
//     names from the *conn.Pool registered as Config.Profiles.
//     Returned Profile entries carry only Name (legacy contract).
func (s *GraphServer) GetProfiles(_ http.ResponseWriter, r *http.Request, _ *gentypes.Empty) (*gentypes.ProfileList, error) {
	if s.cfg.Store != nil {
		ctx := r.Context()
		actr := actorFromContext(ctx)
		isAdmin := hasRole(actr.Roles, "admin")

		// Single visibility-scoped query: the store walks the
		// `scope='system' OR (scope='personal' AND owner_user_id=?)`
		// predicate once (PSR-F4). For non-admins this is the exact
		// row set the response includes; admins still see only their
		// own personal profiles via this path because the response
		// contract is "your visible profiles", not "all profiles" —
		// admin reach across other personal scopes is gated by the
		// per-id GET handler with audit logging.
		all, err := s.cfg.Store.ListVisible(ctx, actr.Subject)
		if err != nil {
			return nil, err
		}
		out := make([]gentypes.Profile, 0, len(all))
		for _, p := range all {
			reveal := isAdmin || p.OwnerUserID == actr.Subject
			out = append(out, toGenProfile(p, reveal))
		}
		return &gentypes.ProfileList{Profiles: out}, nil
	}

	// Legacy fallback: enumerate from the pool only.
	if s.cfg.Profiles == nil {
		return &gentypes.ProfileList{Profiles: nil}, nil
	}
	names := s.cfg.Profiles.Names()
	out := make([]gentypes.Profile, 0, len(names))
	for _, n := range names {
		out = append(out, gentypes.Profile{
			ID:    n,
			Scope: string(conn.ProfileScopeSystem),
			Name:  n,
		})
	}
	return &gentypes.ProfileList{Profiles: out}, nil
}

// toGenProfile converts a conn.Profile to its wire shape. When
// reveal=false (an unauthorised reader of someone else's personal
// profile, or a non-admin reader of a system profile), DSN, TLS,
// pool_overrides, and saved_username are zeroed out so non-owners
// don't see connection secrets.
//
// TLS and PoolOverrides are emitted as jsontext.Value because the
// genapi schema models them as opaque JSON properties (no per-field
// $ref support yet); we marshal the typed conn.TLSMaterial /
// conn.PoolOverrides into the matching wire shape here.
func toGenProfile(p conn.Profile, reveal bool) gentypes.Profile {
	out := gentypes.Profile{
		ID:          p.ID,
		Scope:       string(p.Scope),
		OwnerUserID: p.OwnerUserID,
		Name:        p.Name,
		Description: p.Description,
		IsDefault:   p.Default,
	}
	if reveal {
		out.Dsn = p.DSN
		out.SavedUsername = p.SavedUsername
		if tls, err := marshalTLS(p.TLS); err == nil {
			out.TLS = tls
		}
		if po, err := marshalPoolOverrides(p.PoolOverrides); err == nil {
			out.PoolOverrides = po
		}
	}
	return out
}

// tlsWire / poolOverridesWire are the on-the-wire shapes for the opaque
// `tls` / `pool_overrides` JSON properties (the genapi schema has no
// per-field $ref yet, so we hand-marshal these here).
type tlsWire struct {
	CAPEM         string `json:"ca_pem,omitempty"`
	ClientCertPEM string `json:"client_cert_pem,omitempty"`
	ClientKeyPEM  string `json:"client_key_pem,omitempty"`
}

type poolOverridesWire struct {
	MaxOpenConns      int   `json:"max_open_conns,omitempty"`
	MaxIdleConns      int   `json:"max_idle_conns,omitempty"`
	ConnMaxLifetimeMs int64 `json:"conn_max_lifetime_ms,omitempty"`
	ConnMaxIdleMs     int64 `json:"conn_max_idle_ms,omitempty"`
}

// PSR-F15 / #112 micro-opt: GET /profiles marshals one `tls` and one
// `pool_overrides` JSON object per *revealed* profile (every row for an
// admin). The vast majority of profiles carry neither custom TLS nor
// pool overrides, so the input is the zero value and the JSON output is
// a fixed byte string. Precompute those two strings once at init so the
// list path skips a json.Marshal (and its scratch-buffer allocation)
// per zero-valued profile. The bytes are treated as read-only by every
// caller (they flow straight into the response codec, which only reads
// jsontext.Value), so sharing a single backing array is safe.
var (
	zeroTLSWire = mustMarshalWire(tlsWire{})
	zeroPOWire  = mustMarshalWire(poolOverridesWire{})
)

func mustMarshalWire(v any) jsontext.Value {
	raw, err := json.Marshal(v)
	if err != nil {
		// Both wire structs are plain field-only structs; Marshal cannot
		// fail. Panic at init rather than ship a corrupt encoding.
		panic("server: marshal zero-value profile wire shape: " + err.Error())
	}
	return jsontext.Value(raw)
}

// marshalTLS encodes a conn.TLSMaterial as a jsontext.Value matching
// the wire schema { ca_pem, client_cert_pem, client_key_pem }. The
// all-empty input — the common case — returns the precomputed zero
// encoding without touching the JSON encoder.
func marshalTLS(t conn.TLSMaterial) (jsontext.Value, error) {
	if t == (conn.TLSMaterial{}) {
		return zeroTLSWire, nil
	}
	raw, err := json.Marshal(tlsWire{
		CAPEM:         t.CAPEM,
		ClientCertPEM: t.ClientCertPEM,
		ClientKeyPEM:  t.ClientKeyPEM,
	})
	if err != nil {
		return nil, err
	}
	return jsontext.Value(raw), nil
}

// marshalPoolOverrides encodes a conn.PoolOverrides as a jsontext.Value
// matching the wire schema. ConnMaxLifetime / ConnMaxIdleTime are
// converted from time.Duration to milliseconds for the wire. The zero
// input — the common case — returns the precomputed zero encoding.
func marshalPoolOverrides(o conn.PoolOverrides) (jsontext.Value, error) {
	if o == (conn.PoolOverrides{}) {
		return zeroPOWire, nil
	}
	raw, err := json.Marshal(poolOverridesWire{
		MaxOpenConns:      o.MaxOpenConns,
		MaxIdleConns:      o.MaxIdleConns,
		ConnMaxLifetimeMs: int64(o.ConnMaxLifetime / time.Millisecond),
		ConnMaxIdleMs:     int64(o.ConnMaxIdleTime / time.Millisecond),
	})
	if err != nil {
		return nil, err
	}
	return jsontext.Value(raw), nil
}

// storeErrorToHTTP maps profilestore errors to endpointError values.
// Used by the CRUD handlers in handlers_profiles_crud.go.
//
// Defensive contract (GAP-Q12 / #107): all known profilestore.Err*
// variants get a stable HTTP status + machine-readable code; anything
// else falls through to a 500 with the wrapped error surfaced
// verbatim so server logs can reproduce it. A nil input is treated as
// the same internal-error path (rather than panicking on err.Error()).
// In practice every CRUD callsite gates the call on `if err != nil`,
// so the nil branch is purely defensive.
func storeErrorToHTTP(err error) *endpointError {
	if err == nil {
		return &endpointError{
			status:      http.StatusInternalServerError,
			code:        ErrCodeInternalError,
			description: "unknown store error",
		}
	}
	switch {
	case errors.Is(err, profilestore.ErrNotFound):
		return &endpointError{
			status:      http.StatusNotFound,
			code:        ErrCodeNotFound,
			description: "profile not found",
		}
	case errors.Is(err, profilestore.ErrConflict):
		return &endpointError{
			status:      http.StatusConflict,
			code:        ErrCodeConflict,
			description: "profile name already exists in this scope",
		}
	case errors.Is(err, profilestore.ErrImmutable):
		return &endpointError{
			status:      http.StatusBadRequest,
			code:        ErrCodeImmutable,
			description: "scope and owner cannot be changed",
		}
	case errors.Is(err, profilestore.ErrInvalid):
		return &endpointError{
			status:      http.StatusBadRequest,
			code:        ErrCodeInvalid,
			description: err.Error(),
		}
	default:
		return &endpointError{
			status:      http.StatusInternalServerError,
			code:        ErrCodeInternalError,
			description: err.Error(),
		}
	}
}
