# Auth DDL — Users, Roles, Grants

> **Scope:** authentication and authorisation DDL. Geode v0.5.19
> supports CREATE/DROP USER, CREATE/DROP ROLE, GRANT/REVOKE. CREATE
> POLICY is upstream-deferred; see [policies](./policies.md).

## CREATE USER

```gql
CREATE USER username WITH PASSWORD 'password'
```gql

The password is hashed with the server's configured KDF (default:
Argon2id with parameters set in `geode.toml`) before storage.

### Capability

`/api/v1/capabilities` → `admin_writable.users = true`.

### Errors

- `42000` — username does not match `[a-zA-Z_][a-zA-Z0-9_]*`.
- `23505` — username already exists.
- `28000` — caller lacks the admin role.

---

## DROP USER

```gql
DROP USER username
```gql

Refuses to drop the caller's own account. Granted roles + active
sessions are revoked as part of the operation.

---

## CREATE ROLE

```gql
CREATE ROLE role_name
```gql

Roles are flat — no role inheritance in v0.5.19. A user gains
privileges via `GRANT role_name TO username`.

---

## GRANT

```gql
GRANT role_name TO username
```gql

Idempotent; granting a role the user already holds is a no-op.

---

## REVOKE

```gql
REVOKE role_name FROM username
```gql

The change takes effect on the user's NEXT login. Existing JWTs carry
the role claim until they expire.

---

## See also

- [policies](./policies.md) — row/property-level access (in progress).
- [core](./core.md) — base ISO-GQL clauses.
