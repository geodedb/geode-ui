package profilestore

// Schema is the SQLite DDL for the profile store. The CREATE
// statements use IF NOT EXISTS for v0; future versions introduce a
// schema_migrations table and migrate forward from there.
const Schema = `
CREATE TABLE IF NOT EXISTS profiles (
	id                   TEXT    PRIMARY KEY,
	scope                TEXT    NOT NULL,
	owner_user_id        TEXT    NOT NULL DEFAULT '',
	name                 TEXT    NOT NULL,
	dsn                  TEXT    NOT NULL,
	description          TEXT    NOT NULL DEFAULT '',
	saved_username       TEXT    NOT NULL DEFAULT '',
	is_default           INTEGER NOT NULL DEFAULT 0,
	tls_ca_pem           TEXT    NOT NULL DEFAULT '',
	tls_cert_pem         TEXT    NOT NULL DEFAULT '',
	tls_key_pem          TEXT    NOT NULL DEFAULT '',
	max_open_conns       INTEGER NOT NULL DEFAULT 0,
	max_idle_conns       INTEGER NOT NULL DEFAULT 0,
	conn_max_lifetime_ns INTEGER NOT NULL DEFAULT 0,
	conn_max_idle_ns     INTEGER NOT NULL DEFAULT 0,
	created_at           INTEGER NOT NULL,
	updated_at           INTEGER NOT NULL,
	CHECK (scope IN ('system', 'personal')),
	UNIQUE (scope, owner_user_id, name)
);

CREATE INDEX IF NOT EXISTS profiles_owner_idx
	ON profiles (scope, owner_user_id);
`
