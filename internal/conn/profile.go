// Package conn manages named upstream Geode connections.
//
// A Profile is a named upstream Geode endpoint: the HTTP API resolves a
// profile by name, and the JWT-bound user is constrained to a set of
// profile names via the "profiles" claim in their token.
//
// A Pool holds one *sql.DB per profile. Connections are lazy: the first
// DB(name) call opens the *sql.DB; subsequent calls return the same handle.
package conn

// Profile is a named upstream Geode endpoint.
//
// Name is the lookup key used by the HTTP API and referenced in JWT
// "profiles" claims. DSN is a Geode driver DSN as accepted by
// sql.Open("geode", dsn) — see geodedb.com/geode for the format.
type Profile struct {
	Name           string `json:"name"`
	DSN            string `json:"dsn"` // e.g. "quic://geode-prod.internal:3141"
	TLSCAFile      string `json:"tls_ca_file,omitempty"`
	ClientCertFile string `json:"client_cert_file,omitempty"`
	ClientKeyFile  string `json:"client_key_file,omitempty"`
	Description    string `json:"description,omitempty"`
}
