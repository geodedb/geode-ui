# Connections vs. Profiles — terminology

> **TL;DR:** What the user sees as a **Connection** is internally stored
> as a `Profile` row in `profilestore`. They are the same thing — the
> public-facing noun was changed (GAP-054) because "Profile" was
> ambiguous; the storage layer was not renamed because the wire and
> file-system surfaces are stable.

## Why two names

Pre-GAP-054 the SPA called these "Profiles" everywhere. New users
landing on the Login screen reach for the word with different mental
models:

- **psql / pgcli / DataGrip vocabulary:** "Profile" is the name of a
  saved connection bundle (DSN + saved username + TLS material +
  default flag). That's what Geode meant.
- **OS / SaaS vocabulary:** "Profile" is a user identity ("my user
  profile" = my account).
- **Browser vocabulary:** "Profile" is a UI-preferences pack ("Chrome
  profile" = my saved tabs and bookmarks).

The first reading is the one Geode intended; the other two are the
ones users actually arrived with. So the user-facing copy now says
**Connection** for the entire concept, matching the operator's mental
model of "a named Geode endpoint with optional saved credentials."

## What the rename touches

- ✅ User-visible copy: Login picker label, "Save password for this
  connection", AddConnectionModal title.
- ✅ Connection-switcher menu (already said "Connections").
- ❌ i18n keys: still `auth.profile`, `auth.profileList`, etc. Keys are
  internal identifiers — renaming them would churn every locale and
  every test for no user-visible gain. Only the *values* change.
- ❌ Server-side storage: `internal/profilestore/store.go` still names
  these `Profile` records (columns: `name`, `dsn`, `description`,
  `saved_username`, `is_default`, `tls_*_pem`, conn-pool sizing). The
  wire schema is stable; renaming would break upgrades.
- ❌ API surfaces (`/api/v1/profiles`): part of the documented wire
  contract. Renaming would force every client to follow.
- ❌ Source-code symbols (`Profile`, `ConnectionRecord`, `profilestore`):
  follow the layer they belong to. `ConnectionRecord` is the in-
  memory active-session shape (renderer + electron bridge);
  `Profile` is the on-disk storage shape.

## Glossary

| Term | Meaning |
|---|---|
| **Connection** | The user-facing name for a saved Geode endpoint. Includes DSN, optional saved username/password, optional TLS bundle, and a default-flag. **Not** a user identity, **not** a preferences pack. |
| Profile | The internal storage name for the same thing. Appears in `internal/profilestore/`, the `/api/v1/profiles` route, and source types. Operators should not encounter this term in the UI. |
| Active connection | The in-memory `ConnectionRecord` (JWT + expiresAt) for whichever Connection the user is currently authenticated as. Surfaced in the Connection switcher and `useActiveConnection()`. |
| Default connection | A Connection that has `is_default: true` in `profilestore`. The Login page pre-selects it; the connection switcher shows it first. |

## Migration path (informational)

A future major release MAY rename `internal/profilestore` →
`internal/connectionstore` and `/api/v1/profiles` →
`/api/v1/connections`. That would be a wire-breaking change and is
out of scope for the GAP-054 cohort. Until then, contributors should
keep the two names where they are and consult this doc when adding
new surfaces.
