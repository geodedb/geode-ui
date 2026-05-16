# ADR 0001: Generated API Boundary

## Status

Accepted

## Context

`geode-ui` has a large generated codebase under `gen/` that mediates
between the TypeScript SPA and the Go backend. The generator
(`genapi`) reads `geode.json` — a hand-edited declarative description
of every REST endpoint, WebSocket channel, MCP tool, schema type, and
limiter configuration — and emits:

- `gen/types/` — Go struct definitions for the wire contract.
- `gen/api/` — Go HTTP handler scaffolding (a `ServerInterface`
  callers implement).
- `gen/ws/` — Go WebSocket plumbing.
- `gen/mcp/` — MCP tool dispatchers.
- `gen/client/react/` — a TypeScript client + React Query hooks
  for the SPA.
- `gen/pkg/{httpx,securex,wsx,configx,gen,...}` — shared runtime
  utilities the emitted code depends on.
- `gen/cmd/server/` — a minimal `main.go` that wires the generated
  HTTP / WS / MCP servers together.

Multiple incidents over the past quarter have stemmed from confusion
about where the source of truth lives. The patterns observed:

- **Hand-edits to `gen/`.** A contributor needed a new field on a
  response shape, found the generated struct in `gen/types/`, edited
  it directly, and pushed. The next `make generate` silently
  rewrote the file and reverted the change.
- **Drift between SPA and server contracts.** The SPA wrote its own
  parallel TypeScript type for a backend response shape and edited
  it whenever the server changed, instead of consuming the generated
  client. The contracts drifted twice in one quarter before someone
  noticed at runtime.
- **Generator regressions landing without CI notice.** A contributor
  upgraded the `genapi` binary locally, ran `make generate`, did not
  commit the regenerated `gen/` tree, and pushed only the source-file
  changes. CI's `go:generate-verify` job caught it on MR, but the
  fact that the fix was a `make generate` + commit (rather than
  reverting the spec change) wasn't obvious from the failure
  message.

Resolving each of these required walking a new contributor through the
contract's rules: `geode.json` is the source of truth, `gen/` is
regenerated output, hand-edits to either the SPA's generated client
or any `gen/*` file are forbidden, and the regen flow goes through
`make generate`. That guidance was scattered across `README.md`,
`internal/server/README.md`, and tribal commit-message lore.

## Decision

`docs/adr/0001-generated-api-boundary.md` is the canonical reference
for the generated-API boundary. It is cross-linked from
`internal/server/README.md`, `README.md`, and `CONTRIBUTING.md` so
new contributors can find it in one canonical doc.

The boundary's rules:

1. **`geode.json` is the contract.** Every REST endpoint, WebSocket
   channel, MCP tool, schema type, and security/limiter config is
   declared in `geode.json`. The contract is hand-edited by humans
   and reviewed like any other source change.

2. **`gen/` is regenerated output.** Every file under `gen/` is
   emitted by `genapi generate --config geode.json --out gen/`.
   Hand-edits to `gen/` are forbidden — they will be silently
   reverted by the next regen pass.

3. **Regen flow goes through `make generate`.** Contributors run
   `make generate` after editing `geode.json` and commit the
   resulting `gen/` diff alongside the spec change in the same
   commit. `make generate` is sentinel-aware (QUALITY #177) and
   skips the regen pass when `geode.json` is unchanged.

4. **The SPA consumes the generated client.** TypeScript code that
   talks to the backend imports types and request functions from
   `gen/client/react/` (re-exported via the `@api` path alias —
   see `tsconfig.json` `paths`). New parallel hand-written client
   types are forbidden. The narrow legacy-normalization exception
   for `src/api/profiles.ts` (a fail-closed adapter that pre-dates
   the generator's TypeScript templates maturing) is the only
   permitted divergence; see the in-file comment at
   `src/api/profiles.ts:1-5`.

5. **Generator drift is caught at MR time.** CI's
   `go:generate-verify` job (`.gitlab-ci.yml:314`) re-runs
   `make generate` against the pinned `genapi` version and
   `git diff --exit-code -- gen/` fails the pipeline if the regen
   would produce changes not committed in the MR.

6. **Pinned generator version.** The `genapi` version is pinned in
   `scripts/install-tools.sh` (`GENAPI_VERSION`) and mirrored in
   `.gitlab-ci.yml`'s `go:generate-verify` job. Bump deliberately
   and in lockstep — a one-side bump fails CI loudly.

## Consequences

### Positive

- Source of truth is unambiguous: a single line ("`geode.json` is
  the contract") closes the most common contributor question.
- A regression in either the spec, the generator, or the regenerated
  tree fails fast — `go:generate-verify` is a hard gate, not a
  warning.
- The SPA consumes the same types the server emits; contract drift
  surfaces as a TypeScript build error at edit time instead of a
  runtime 404 / 500.
- Tooling investments (sentinel-aware regen, pinned generator
  version, ratcheting coverage on the generated code) compound: each
  one is a small win that adds up across hundreds of merges.

### Negative

- A spec change requires touching N files (the `geode.json` edit +
  the regen output across `gen/`). Commit reviewers must inspect
  both halves — but the diff in `gen/` is mechanically derivable
  from the spec change, so the cognitive load is bounded.
- The generator pin (`@v0.3.1` today) creates a coupling between
  this repo and upstream `genapi`. We accept the coupling because
  the alternative (floating `@latest`) silently changes the wire
  contract across pipelines, which is worse.

### Migration

The rules above already match the de-facto convention; this ADR is
the codification, not a behavioral change. The cross-links from
`internal/server/README.md` and the top-level `README.md` are added
in the same commit that introduces this ADR.
