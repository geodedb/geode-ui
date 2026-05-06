# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## v0.1.0 — 2026-05-06

Initial release.

### Backend (Go API)

- `genapi`-generated REST API with 44 endpoints across query, schema discovery,
  transactions, user/role/policy/grant management, backup/restore, migrations,
  audit log, MCP, profiles, and login.
- WebSocket streaming GQL queries via `/ws/query`.
- HS256 JWT auth with `profile` and `roles` claims; `required_roles`
  enforcement on admin routes.
- Connection pool with multiple upstream profiles (functional-options config).
- Audit log with sensitive-key redaction; ring-buffer query endpoint.
- MCP `query` tool reachable at `/mcp`.

### Frontend (React + TypeScript SPA)

- Login + protected routes with `AuthProvider`.
- Connection profile picker.
- Monaco GQL editor with Monarch syntax highlighting.
- Tabular + JSON + interactive graph result views.
- Cytoscape graph visualization with label-coloured nodes and click-to-inspect.
- Schema explorer (graphs / labels / edge types / indexes / constraints).
- Admin UIs for users, roles, policies, grants.
- Ops UIs for backups, restore, migrations, audit log.
- WebSocket streaming queries with progressive table population.

### Infrastructure

- Multi-stage Dockerfile (Node web build → Go static binary → Alpine runtime).
- GitLab CI pipeline: `golangci-lint`, `make generate` verification,
  `go test -race -cover`, and `docker build`.
- `make` targets for build / test / generate / lint / dev.

[v0.1.0]: https://gitlab.com/devnw/geode/geode-ui/-/releases/v0.1.0
