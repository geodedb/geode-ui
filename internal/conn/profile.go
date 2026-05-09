// Package conn manages named upstream Geode connections.
//
// A Profile is a named upstream Geode endpoint: the HTTP API resolves a
// profile by name, and the JWT-bound user is constrained to a set of
// profile names via the "profiles" claim in their token.
//
// A Pool holds one *sql.DB per profile. Connections are lazy: the first
// DB(name) call opens the *sql.DB; subsequent calls return the same handle.
package conn

import "time"

// ProfileScope distinguishes admin-managed system profiles from
// per-user personal profiles. The store enforces (scope, owner_user_id,
// name) uniqueness and ownership semantics off this field.
type ProfileScope string

const (
	ProfileScopeSystem   ProfileScope = "system"
	ProfileScopePersonal ProfileScope = "personal"
)

// Valid reports whether the scope is one of the two recognised values.
func (s ProfileScope) Valid() bool {
	switch s {
	case ProfileScopeSystem, ProfileScopePersonal:
		return true
	}
	return false
}

// PoolOverrides holds per-profile pool tuning. Zero-valued fields fall
// back to the pool-wide PoolConfig defaults at *sql.DB construction.
type PoolOverrides struct {
	MaxOpenConns    int           `json:"max_open_conns,omitempty"`
	MaxIdleConns    int           `json:"max_idle_conns,omitempty"`
	ConnMaxLifetime time.Duration `json:"conn_max_lifetime,omitempty"`
	ConnMaxIdleTime time.Duration `json:"conn_max_idle_time,omitempty"`
}

// TLSMaterial is the PEM-encoded TLS material for a Geode upstream.
// Empty fields mean "do not present client cert" / "trust the system
// CA bundle". The legacy file-path fields on Profile are kept for the
// boot-time JSON migration path; sqlite Put/Patch only persist PEM text.
type TLSMaterial struct {
	CAPEM         string `json:"ca_pem,omitempty"`
	ClientCertPEM string `json:"client_cert_pem,omitempty"`
	ClientKeyPEM  string `json:"client_key_pem,omitempty"`
}

// Profile is a named upstream Geode endpoint.
//
// Name is the lookup key used by the HTTP API and referenced in JWT
// "profiles" claims. DSN is a Geode driver DSN as accepted by
// sql.Open("geode", dsn) — see geodedb.com/geode for the format.
// ID is assigned by the profilestore on Put; the legacy file-path
// fields are kept only for the boot-time JSON migration path and
// are NEVER persisted by the SQLite store (cmd/server/main.go's
// seedFromJSON reads their contents into TLS.* PEM strings on first
// launch).
type Profile struct {
	ID            string        `json:"id"`
	Scope         ProfileScope  `json:"scope"`
	OwnerUserID   string        `json:"owner_user_id,omitempty"` // empty when scope=system
	Name          string        `json:"name"`
	DSN           string        `json:"dsn"`
	Description   string        `json:"description,omitempty"`
	SavedUsername string        `json:"saved_username,omitempty"`
	Default       bool          `json:"is_default"`
	TLS           TLSMaterial   `json:"tls,omitzero"`
	PoolOverrides PoolOverrides `json:"pool_overrides,omitzero"`

	// Legacy file-path fields kept for boot-time JSON migration. The
	// store NEVER persists these; cmd/server/main.go:seedFromJSON reads
	// the file contents into the matching TLS PEM field at seed time.
	TLSCAFile      string `json:"tls_ca_file,omitempty"`
	ClientCertFile string `json:"client_cert_file,omitempty"`
	ClientKeyFile  string `json:"client_key_file,omitempty"`
}
