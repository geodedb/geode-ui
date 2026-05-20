# Migrations

> **Scope:** the migration workflow Geode v0.5.19 supports. See
> GAP-053 for the rollback / target-version follow-up (blocked on
> upstream wire op).

## Authoring

Two paths converge on the same `migrationUpload` endpoint:

1. **Upload** — write a `.gql` file locally and upload via the New
   Migration modal.
2. **Compose (GAP-052)** — paste / type the body directly in the
   modal. The body is synthesised into a Blob and shipped through
   the same upload endpoint.

The server enforces a 64 MiB upload cap and refuses filenames outside
`[A-Za-z0-9._-]+`.

## Application order

`Run pending` applies every staged migration in lexicographic
filename order. A failure stops the chain and leaves the prior
migrations applied (no transactional rollback in v0.5.19).

## Signing

Each applied migration may carry a signature from the operator that
applied it. The signature is recorded alongside the row's
`appliedAt` timestamp and shows in the migrations table.

## Limitations (v0.5.19)

- **No `down` / rollback** — see GAP-053.
- **No `--target` parameter** — see GAP-053.
- **No transactional batching** — a half-applied chain stays half-
  applied; recover by writing a forward fix-up migration.

## See also

- [core](./core.md), [auth-ddl](./auth-ddl.md).
