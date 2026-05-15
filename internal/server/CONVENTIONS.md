# internal/server conventions

Cross-cutting rules the `handlers_*.go` files follow. This is the
"why and where" companion to the per-file doc comments — read it before
adding a handler. (`README.md` in this directory is the layout map;
this file is the behavioural contract.)

## 1. Error-code taxonomy

- Every error envelope emitted by this package carries a `code` value
  that is a **stable wire identifier**: the SPA keys i18n messages off
  it and external API consumers branch on it. Renaming a code value is
  a breaking change.
- All distinct codes live as typed `ErrCode*` constants in
  `errorcodes.go`, grouped by area (generic / auth / password-policy /
  profile-CRUD / schema / tx / uploads / audit / admin-RBAC / WS).
- `errorcodes_test.go` is a golden test (a dep-free `go/ast` walk over
  the package source) that fails if a handler introduces a literal
  error code in a `code:`/`Code:` composite field or in the code-arg
  position of `badRequest` / `writeBadRequest` / `writeEndpointErr` /
  `writeErr` without a constant — and also fails on a dead `ErrCode*`
  constant. Adding a new error code therefore means adding the
  constant in `errorcodes.go` (and the matching `allErrorCodes` entry).
- Canonical examples: `errors.go` (`wireErr` / `endpointError`),
  `handlers_uploads.go` (the eight `upload_*` codes),
  `handlers_tx.go` (the `tx_*` codes), `ws_query.go` (`writeErr` with
  the WS-frame codes).
- Out of scope here, noted as a follow-up: the SPA's `errors.*` i18n
  key map could be cross-checked against `errorcodes.go`.

## 2. Empty-result rule for list endpoints (#168)

- A list endpoint **always returns a non-nil empty slice** on no
  results — `[]`, never `null`. Build the result with
  `make([]T, 0, len(rows))` (or `[]T{}`); never `var out []T` that the
  loop might never append to.
- The admin-RBAC list endpoints (`GetUsers` / `GetRoles` /
  `GetPolicies` / `GetBackups` and `GetMigrations`) additionally
  **tolerate an `isWireFeatureMissing` upstream by returning a 200
  empty list** rather than surfacing a 4xx — older Geode wire dialects
  do not ship the catalog DDL yet. See `handlers_roles.go` `GetRoles`
  and `handlers_migrations.go` `GetMigrations` for the canonical shape.
- **Single-resource lookups behave differently**: a not-found row is a
  404 with a `*_not_found` code (`role_not_found`, `policy_not_found`,
  `backup_not_found`, `user_not_found`). Do not collapse that split —
  the list path swallows wire-feature-missing, the single-resource path
  does not.
- `list_handlers_test.go` pins both halves (non-nil empty slice on
  empty result; graceful 200 empty list on wire-feature-missing).

## 3. Wire-feature-missing fallback pattern

- `isWireFeatureMissing(err)` (in `errors.go`) reports whether an
  upstream error means "this Geode build does not implement this verb"
  rather than "your input was bad". Detection order: the
  `errWireFeatureMissing` sentinel (via `errors.Is`), then a typed
  `StatusClass() == "42000"` interface, then a **pinned** substring
  fallback (`wireFeatureMissingSubstrings`, exhaustively tested in
  `errors_test.go` so driver-message drift cannot silently widen it).
- Why: forward-compat with older Geode wire dialects. A read handler
  that trips this degrades to an empty list (HTTP 200) instead of
  surfacing a 422 on every dashboard page load.
- Call sites that *know* the upstream returned "verb not implemented"
  should wrap with `fmt.Errorf("...: %w", errWireFeatureMissing)` so
  detection short-circuits without relying on the driver's free-form
  text. `wireErr` (in `errors.go`) upgrades a detected wire-feature
  miss to a `501 wire_feature_missing` envelope; otherwise it emits a
  `422 user_admin_error`.

## 4. Per-row column-key dual-key forward-compat

- `policyFromRow` (`handlers_policies.go`) and `roleFromRow`
  (`handlers_roles.go`) accept **both** `name` and an entity-specific
  synonym when reading a row's identity column: `case "name", "policy":`
  and `case "name", "role":` respectively. (`userFromRow` projects onto
  the typed `User` and does not need this — the username column name is
  fixed.)
- Why: the upstream Geode `SHOW POLICIES` / `SHOW ROLES` result-column
  naming is not yet stable across wire versions; some builds emit
  `name`, others the entity name. Accepting both keeps the handler
  resilient across that window.
- When it can be dropped: once the upstream Geode wire stabilises the
  catalog result-column names, collapse each `case` back to a single
  key.

## 5. Audit-event constant naming

- Audit event identifiers are the `auditEvent*` constants in `audit.go`
  (`auditEventLoginSuccess`, `auditEventUserCreated`,
  `auditEventMigrationRun`, …). Use a constant — never a literal
  string — when calling `emitAudit`.
- `emitAudit(event, kv...)` writes one record to `slog` at INFO level
  (prefixed `AUDIT`) **and** appends to the in-memory ring buffer that
  backs `GET /api/v1/audit`. It is **best-effort, log-and-continue**: a
  panic from a misbehaving slog handler or the ring is caught and
  surfaced as a one-line stderr warning — auditing is observability,
  not security gating, so it never escalates into a 500 (GAP-Q7 / #37).
  That is why call sites invoke it with no error return.
- Sensitive values are redacted to `[REDACTED]` before either
  destination sees them, using a **substring** match on the field key:
  `obsx.DefaultSensitiveKeyFragments` (the central credential-fragment
  list — `password` / `token` / `bearer` / …) plus the geode-ui-local
  additions in `audit.go`'s `sensitiveKeys` (`saved_password`,
  `tls_client_*`, `url`, `connection_string`, …). Over-redaction is
  cheaper than a leak; callers should still avoid passing secrets in
  the first place.

## 6. The envelope helpers

- `endpointError{status, code, description}` (`errors.go`) is the
  structured handler error; `writeEndpointError(w, *endpointError)`
  serialises it as the `{error, error_description}` JSON body with a
  deterministic key order (GAP-N10 — the `/auth/login` failure path
  must be byte-identical across failure modes).
- Shorthands: `writeEndpointErr(w, status, code, msg)` for the inline
  case, `writeBadRequest(w, code, msg)` (400), `writeNotFound(w, msg)`
  (404 `not_found`), `writeStoreUnavailable(w)` (503 `store_disabled`),
  `badRequest(code, desc)` for a 400 `*endpointError` returned from a
  validation failure.
- `respondErr(w, err)` (the wire-handlers analogue;
  `schemaResponseErr(w, err)` for the schema handlers) inline-writes an
  `*endpointError` and returns `nil` so the genapi wrapper does not
  emit a second body, and passes non-endpoint errors through unchanged
  so they surface as a 500.
- Admin-RBAC handler skeleton: JWT auth (middleware) → resolve the
  request's connection `*sql.DB` → quote any identifier from the path —
  `withConnDBAndIdent(ctx, name, func(db *sql.DB, qname string) error)`
  (`handlers_users.go`) collapses that preamble for the user handlers;
  handlers that need only the `*sql.DB` use `connDB(ctx)` directly. The
  validated-and-quoted identifier is the load-bearing safety boundary
  for these endpoints — never interpolate a raw path segment into a GQL
  statement.
