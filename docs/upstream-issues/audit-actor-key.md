# Normalize audit-emit actor field on a single canonical key

**Target repo:** `gitlab.com/devnw/codepros/geode/geode` (the server)
**Reporter context:** geode-ui v0.5.19, observed in the `/admin/audit` table
**Severity:** quality / DX — no data loss, but audit-log consumers (UI, SIEM forwarders, grep-the-log on-call workflows) have to know the per-event idiom to attribute each row.

## Summary

The Go server's `emitAudit(event, kv...)` callers use three different field
names for the operator-identifier across the codebase:

| Field name | Emitters (non-exhaustive) |
| --- | --- |
| `user`   | `handlers_query.go`, `handlers_tx.go`, `handlers_grants.go`, `handlers_roles.go`, `handlers_policies.go`, `handlers_migrations.go`, `handlers_backups.go` |
| `sub`    | `handlers_auth.go` (`auth_role_resolved`, refresh-token paths, etc.) |
| `actor`  | `handlers_profiles_crud.go` (`profile_created` / `_updated` / `_deleted`) |

Independently, `security_headers.go` emits `access_token_query` with neither
of the three — it fires from middleware that runs before the auth context
is set, so there is no actor to attach.

## Impact

- **UI:** the geode-ui audit table used to render the User column from
  `fields.user` alone and showed an empty cell for every JWT-driven event,
  every profile event, and every system event. Bridged client-side in
  `src/components/ops/AuditLogPage.tsx`
  (`AUDIT_USER_KEYS = ['user', 'username', 'sub', 'actor']`,
  `SYSTEM_ACTOR = 'system'`) — see commit `5e94a4c` in
  gitlab.com/devnw/codepros/geode/geode-ui.

- **Filtering / search:** `/api/v1/audit?user=alice` only matches rows
  where the emitter happened to use `user` as the key. Rows attributed
  to `alice` via `sub` or `actor` slip through the filter.

- **Downstream consumers:** any operator who exports the audit ring
  (SIEM forwarder, JSONL pipe, etc.) and tries to group-by actor has
  to know all three conventions or write a fan-in that does.

## Proposal

Pick ONE canonical key and migrate every `emitAudit()` caller onto it.
Strong preference for `actor` because:

1. `user` is overloaded — many audit rows ALSO carry a "target user"
   distinct from the acting user (e.g. `user_created` has both an actor
   AND the new user's name). `actor`/`target` is the unambiguous split.
2. `sub` leaks JWT terminology into the audit schema; most consumers
   don't think in JWT claims.
3. `actor` matches the existing `handlers_profiles_crud.go` convention
   and the OpenTelemetry semantic conventions for security events.

Migration plan (sketch):

1. Add a helper in `internal/server/audit.go`:

   ```go
   func auditActor(ctx context.Context) string { return userFromContext(ctx) }
   ```

   and a constant `auditFieldActor = "actor"`.

2. Sweep every `emitAudit(...)` call that currently passes
   `"user", userFromContext(...)` to instead pass
   `auditFieldActor, auditActor(ctx)`.

3. Update `handlers_auth.go` to emit `actor` (not `sub`) for the
   `auth_role_resolved` row. The `sub` claim can still ride along under
   `jwt_sub` if it's useful to keep — but the canonical actor key is
   `actor`.

4. `handlers_profiles_crud.go` is already on `actor` — no change.

5. `security_headers.go` `access_token_query` emitter should attach
   `actor: "system"` explicitly (or leave it absent — but the UI now
   defaults to `"system"` either way, so explicit is cleaner).

6. Update `internal/server/audit_test.go` and
   `internal/server/handlers_audit_test.go` to assert the new key.

7. Bump audit-schema version (if there's one) and note the rename in
   the release CHANGELOG so SIEM consumers can rewrite their grep
   pipelines.

## Acceptance

- Every `emitAudit()` call in `internal/server/` uses `actor` for the
  acting principal.
- `/api/v1/audit?actor=alice` filter works against every row attributed
  to `alice` regardless of the originating handler.
- `access_token_query` either emits `actor: "system"` or the absence
  is documented as the system-event sentinel.
- geode-ui's `AUDIT_USER_KEYS` compatibility shim can be collapsed to
  `['actor']` once the server-side rollout is done.

## Workaround (already in place)

geode-ui resolves the column across all three keys and defaults to
`"system"`. See commit `5e94a4c` in geode-ui.
