# Geode v0.5.15 Auth DDL Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire geode-ui to use Geode v0.5.15's new GQL auth DDL surface (CREATE/ALTER/DROP USER+ROLE, GRANT/REVOKE per-graph, SHOW USERS/ROLES/PERMISSIONS/VERSION/CAPABILITIES) and close the upstream-blocked admin gaps GAP-002..005, GAP-013..016, Q53 #198.

**Architecture:** geode-ui server (internal/server) emits GQL DDL via the existing `runQuery` driver path. The handlers already wrap statements with `isWireFeatureMissing(err)` fallbacks that returned "wire feature missing" on Geode ≤ v0.5.11. With v0.5.15 server-side parsing of auth DDL, the success path now lights up. A new `SHOW CAPABILITIES` probe drives `handlers_capabilities.go` so the SPA's `admin_writable.{users,roles,policies,grants}` flags reflect connected-server reality instead of hard-coded `false`. e2e specs 07/08/09 (and possibly 10) get unskipped and pinned.

**Tech Stack:** Go 1.26 (`GOEXPERIMENT=jsonv2`), `geode.json` API contract (regenerate via `make generate`), Jest, Playwright (e2e), `scripts/run-go.sh` for Go commands, GitLab CI.

---

## Preconditions

- **Upstream:** Geode v0.5.15 is tagged at `0cde61a5` in `~/src/devnw/codepros/geode/geode`. The auth DDL grammar is documented at `~/src/devnw/codepros/geode/geode/docs/GQL_AUTH_DDL.md` (read at v0.5.15) and implemented by `src/execution/admin_ddl.zig` + `src/execution/auth_dispatch.zig`. Parsing is via soft keywords (USER, ROLE, GRANT, REVOKE, SHOW remain valid identifiers in ordinary queries).
- **Bindings:** `geode-client-go` does NOT need a version bump — the driver passes GQL strings; the server now accepts more of them. Confirm with task 1's smoke test.
- **In-flight work:** Bundle D (GraphView split, #192) is running in a separate session. Wait for that branch to land before starting this plan to avoid merge conflicts in unrelated files. Files this plan touches are disjoint from Bundle D, but the `docs/QUALITY_GAP_ANALYSIS.md` and `docs/GAP_ANALYSIS.md` tables overlap — coordinate.
- **No `gen/` edits.** `gen/api/handlers_gen.go` is emitted by `~/src/devnw/go/genapi` from `geode.json`. If a handler signature needs to change, edit `geode.json` and run `make generate`. Do not hand-edit `gen/`.

---

## Affected Files

**Server (handwritten Go) — modify:**

- `internal/server/handlers_capabilities.go` — replace 2 TODOs at L30, L41 with `SHOW CAPABILITIES` + `SHOW VERSION` probe; populate `admin_writable.{users,roles,policies,grants}` from result rows
- `internal/server/handlers_users.go` — drop the wire_feature_missing fallback on `SHOW USERS` (keep it as belt-and-suspenders); pin row schema to the v0.5.15 columns; verify `CREATE USER SET PASSWORD … EMAIL …` matches the new grammar
- `internal/server/handlers_roles.go` — same pattern (`SHOW ROLES`, `CREATE ROLE`, `DROP ROLE`)
- `internal/server/handlers_policies.go` — wire `SHOW PERMISSIONS [ FOR <user> ]`; document that `CREATE POLICY` is still upstream-deferred (see "Future" in GQL_AUTH_DDL.md)
- `internal/server/handlers_grants.go` — wire `GRANT/REVOKE READ|WRITE|SCHEMA|ALL [ ON GRAPH <g> ] TO <u>`
- `internal/server/handlers_users_test.go`, `handlers_roles_test.go`, `handlers_policies_test.go`, `handlers_grants_test.go`, `handlers_capabilities_test.go` — add positive-path tests using a fake driver that returns v0.5.15-shaped rows
- `internal/server/errors.go` — leave `wireFeatureMissingSubstrings` and `isWireFeatureMissing` unchanged; still used as graceful-degradation guards for ≤ v0.5.11 servers and as a tripwire

**SPA (TypeScript) — modify:**

- `src/auth/useCapabilities.ts` (or equivalent — locate during task 2) — surface `geode_version` + `admin_writable.{users,roles,policies,grants}` to SPA UI gates
- `src/pages/AdminPage.tsx`, `UsersPage.tsx`, `RolesPage.tsx`, `PoliciesPage.tsx`, `GrantsPanel.tsx` — gate CTAs on `admin_writable.*` (already wired; verify after capability fix lights up)

**E2E — un-skip:**

- `e2e/specs/07-admin-users.spec.ts` (GAP-002 / GAP-013 probes at L27, L49, L75, L83)
- `e2e/specs/08-admin-roles-policies.spec.ts` (GAP-003 / GAP-014 at L4-13)
- `e2e/specs/09-ops.spec.ts` (GAP-004 / GAP-015 audit-role at L37-47 — verify what audit-role means; may still be upstream-blocked)
- `e2e/specs/10-mcp-endpoint.spec.ts` (GAP-005 / GAP-016 at L124-127 — `tools/list` was NOT part of v0.5.15; keep skipped)

**Docs — update:**

- `docs/GAP_ANALYSIS.md` — close GAP-002, GAP-003, GAP-013, GAP-014, mark GAP-004/015 as "still upstream-blocked" or close if v0.5.15 fixed it, keep GAP-005/016 upstream-blocked
- `docs/GAP_ANALYSIS_RESOLVED.md` — append RESOLVED block per closed gap
- `docs/QUALITY_GAP_ANALYSIS.md` — close Q53 #198 in 2026-05-13 cohort table
- `docs/ARCHITECTURE.md` — document v0.5.15 wire features under "Auth model"
- `README.md` — bump the "requires Geode ≥ v0.5.x" minimum and link to GQL_AUTH_DDL.md
- `geode.json` — verify no new endpoints needed; `/api/v1/capabilities` shape may grow `geode_version` field. If yes, regenerate `gen/` via `make generate`.

---

## Task 1: Smoke-test v0.5.15 wire compatibility

**Files:**
- Test: `internal/server/geode_v0_5_15_compat_test.go` (NEW)

- [ ] **Step 1: Locate a runnable Geode v0.5.15 binary**

Run: `ls ~/src/devnw/codepros/geode/geode/zig-out/bin/ 2>/dev/null && git -C ~/src/devnw/codepros/geode/geode describe --tags`
Expected: `geode` binary built from a checkout at or past tag `v0.5.15`. If missing, document `make build` in the geode repo as a prerequisite and stop. Do NOT proceed without a real v0.5.15 to probe.

- [ ] **Step 2: Write smoke test that exercises every new DDL form**

Create `/data/home/benji/src/devnw/codepros/geode/geode-ui/internal/server/geode_v0_5_15_compat_test.go`:

```go
//go:build integration

package server

import (
	"context"
	"testing"
)

// TestGeodeV0_5_15_AuthDDLSurface is an integration test that exercises the
// v0.5.15 auth DDL grammar via a real Geode driver. Skipped unless
// GEODE_INTEGRATION_DSN is set in the environment.
func TestGeodeV0_5_15_AuthDDLSurface(t *testing.T) {
	dsn := os.Getenv("GEODE_INTEGRATION_DSN")
	if dsn == "" {
		t.Skip("set GEODE_INTEGRATION_DSN to run against a live v0.5.15 server")
	}
	db, err := sql.Open("geode", dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	cases := []struct{ name, stmt string }{
		{"show_version", "SHOW VERSION"},
		{"show_capabilities", "SHOW CAPABILITIES"},
		{"show_users", "SHOW USERS"},
		{"show_roles", "SHOW ROLES"},
		{"show_permissions_self", "SHOW PERMISSIONS"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rows, _, err := runQuery(context.Background(), db, tc.stmt)
			if err != nil {
				t.Fatalf("%s: %v", tc.stmt, err)
			}
			t.Logf("%s rows: %d", tc.stmt, len(rows))
		})
	}
}
```

- [ ] **Step 3: Run the smoke test**

Run: `GEODE_INTEGRATION_DSN='geode://admin:password@localhost:7687/__system' scripts/run-go.sh test -tags=integration -run TestGeodeV0_5_15_AuthDDLSurface -v ./internal/server/...`
Expected: PASS for every subtest. Record actual columns + row counts in test logs for use in subsequent tasks (especially Task 3's column pinning).

- [ ] **Step 4: Capture columns + first row of each SHOW**

In a scratch file `/tmp/geode-v0-5-15-show-rows.txt`, copy the t.Logf output. This is the source of truth for the column schemas pinned in tasks 3, 4, 5, 6.

- [ ] **Step 5: Commit the smoke test**

```bash
git add internal/server/geode_v0_5_15_compat_test.go
git commit -m "$(cat <<'EOF'
test(integration): add v0.5.15 auth DDL surface smoke test

Skipped unless GEODE_INTEGRATION_DSN is set. Exercises SHOW VERSION,
SHOW CAPABILITIES, SHOW USERS, SHOW ROLES, SHOW PERMISSIONS against
a live v0.5.15 Geode driver. Output drives column pinning in
subsequent handler tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Locate and inspect the SPA capabilities consumer

**Files:**
- Read-only: locate the SPA hook that calls `/api/v1/capabilities`

- [ ] **Step 1: Find the capabilities consumer**

Run: `grep -rnE "api/v1/capabilities|getCapabilities|useCapabilities" src/`
Expected: a hook (likely `src/auth/useCapabilities.ts` or `src/lib/useCapabilities.ts`) plus call sites in `src/pages/AdminPage.tsx`, `UsersPage.tsx`, `RolesPage.tsx`, `PoliciesPage.tsx`, `GrantsPanel.tsx`.

- [ ] **Step 2: Read the hook**

Run: `cat <path-from-step-1>`
Expected: returns the current shape consumed (e.g., `{ admin_writable: { users: boolean, ... }, geode_version: string }`). Record this shape — Task 3's server-side change must match it exactly.

- [ ] **Step 3: Read one call site to confirm gate behavior**

Run: `grep -B2 -A4 "admin_writable" src/pages/AdminPage.tsx`
Expected: shows the gate (e.g., `disabled={!capabilities.admin_writable.users}`). No code change here — this is verification that Task 3's flag flip will activate the right gates.

---

## Task 3: Wire SHOW CAPABILITIES into handlers_capabilities.go (closes Q53 #198)

**Files:**
- Modify: `/data/home/benji/src/devnw/codepros/geode/geode-ui/internal/server/handlers_capabilities.go`
- Test: `/data/home/benji/src/devnw/codepros/geode/geode-ui/internal/server/handlers_capabilities_test.go`

- [ ] **Step 1: Write failing test**

Add to `handlers_capabilities_test.go`:

```go
// TestGetCapabilities_PopulatesFromShowCapabilities asserts the handler
// runs `SHOW CAPABILITIES` against the upstream driver and reflects
// admin_writable flags from the result. Behavior matrix:
//   - server returns rows that include "auth_ddl_users":true → admin_writable.users=true
//   - server returns wire_feature_missing → admin_writable.users=false (legacy fallback)
//   - server times out or fails → fall back to admin_writable.* all false, log warning
func TestGetCapabilities_PopulatesFromShowCapabilities(t *testing.T) {
	fake := &fakeDriver{
		rows: [][]any{
			{"auth_ddl_users", true},
			{"auth_ddl_roles", true},
			{"auth_ddl_grants", true},
			{"auth_ddl_policies", false}, // not yet in v0.5.15
			{"mcp_tools_list", false},
		},
		cols: []string{"name", "enabled"},
	}
	srv := newTestServer(t, fake)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	rec := httptest.NewRecorder()
	srv.GetCapabilities(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		AdminWritable struct {
			Users, Roles, Policies, Grants bool
		} `json:"admin_writable"`
		GeodeVersion string `json:"geode_version"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.AdminWritable.Users || !resp.AdminWritable.Roles || !resp.AdminWritable.Grants {
		t.Errorf("admin_writable underset: %+v", resp.AdminWritable)
	}
	if resp.AdminWritable.Policies {
		t.Errorf("admin_writable.policies should be false (CREATE POLICY not in v0.5.15)")
	}
}

func TestGetCapabilities_LegacyServerGetsAllFalse(t *testing.T) {
	fake := &fakeDriver{err: &mockWireFeatureMissingError{}}
	srv := newTestServer(t, fake)
	rec := httptest.NewRecorder()
	srv.GetCapabilities(rec, httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d", rec.Code)
	}
	var resp struct {
		AdminWritable map[string]bool `json:"admin_writable"`
	}
	json.Unmarshal(rec.Body.Bytes(), &resp)
	for k, v := range resp.AdminWritable {
		if v {
			t.Errorf("expected %s=false on legacy server, got true", k)
		}
	}
}
```

If `fakeDriver` does not exist with this shape, locate the existing test-driver helper (likely in `internal/server/testdriver.go` or similar) and extend it. Reuse, don't duplicate.

- [ ] **Step 2: Run test, confirm failure**

Run: `scripts/run-go.sh test -race -run 'TestGetCapabilities' ./internal/server/...`
Expected: FAIL — current handler hardcodes `users:false` etc.

- [ ] **Step 3: Implement the probe**

Edit `internal/server/handlers_capabilities.go`. Replace the L30 and L41 TODO bodies with:

```go
func (s *GraphServer) GetCapabilities(w http.ResponseWriter, r *http.Request) {
	caps := capabilitiesResponse{
		GeodeUIVersion: s.cfg.Version,
	}

	db, err := s.driverFor(r)
	if err == nil {
		caps.GeodeVersion = readShowVersion(r.Context(), db)
		caps.AdminWritable = readShowCapabilities(r.Context(), db)
	}
	writeJSON(w, http.StatusOK, caps)
}

// readShowVersion returns the connected Geode build's reported version, or
// the empty string if SHOW VERSION is not understood (legacy server).
func readShowVersion(ctx context.Context, db *sql.DB) string {
	rows, _, err := runQuery(ctx, db, "SHOW VERSION")
	if err != nil || len(rows) == 0 {
		return ""
	}
	// Single-row, single-column result per GQL_AUTH_DDL.md.
	if v, ok := rows[0][0].(string); ok {
		return v
	}
	return ""
}

// readShowCapabilities returns the admin_writable flags by running
// SHOW CAPABILITIES. The Geode v0.5.15 response is a list of
// (name, enabled) rows. We map names to admin_writable fields; unknown
// names are ignored. Returns the zero value (all false) on legacy/older
// servers (wire_feature_missing) or driver error.
func readShowCapabilities(ctx context.Context, db *sql.DB) AdminWritable {
	rows, _, err := runQuery(ctx, db, "SHOW CAPABILITIES")
	if err != nil || len(rows) == 0 {
		return AdminWritable{}
	}
	out := AdminWritable{}
	for _, row := range rows {
		if len(row) < 2 {
			continue
		}
		name, _ := row[0].(string)
		enabled, _ := row[1].(bool)
		switch name {
		case "auth_ddl_users":
			out.Users = enabled
		case "auth_ddl_roles":
			out.Roles = enabled
		case "auth_ddl_grants":
			out.Grants = enabled
		case "auth_ddl_policies":
			out.Policies = enabled
		}
	}
	return out
}
```

Define `AdminWritable` if it doesn't exist as a struct. Reuse the existing field names visible in `gen/types/` (run `grep -rn 'AdminWritable' gen/types/`).

- [ ] **Step 4: Run tests**

Run: `scripts/run-go.sh test -race -run 'TestGetCapabilities' ./internal/server/...`
Expected: PASS.

- [ ] **Step 5: Run full server test suite**

Run: `scripts/run-go.sh test -race -cover ./internal/server/...`
Expected: PASS, coverage ≥ pre-change.

- [ ] **Step 6: Commit**

```bash
git add internal/server/handlers_capabilities.go internal/server/handlers_capabilities_test.go
git commit -m "$(cat <<'EOF'
feat(server): close Q53 (#198) — probe SHOW CAPABILITIES + SHOW VERSION

Replace hard-coded admin_writable=false flags with runtime probe.
On v0.5.15 servers, admin_writable.{users,roles,grants} now reflect
real capability; admin_writable.policies stays false (CREATE POLICY
still upstream-deferred). Legacy servers (≤v0.5.11) return
wire_feature_missing and the response falls back to all-false.

Tests:
- TestGetCapabilities_PopulatesFromShowCapabilities
- TestGetCapabilities_LegacyServerGetsAllFalse

Closes #198

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Validate handlers_users.go on v0.5.15

**Files:**
- Read: `/data/home/benji/src/devnw/codepros/geode/geode-ui/internal/server/handlers_users.go`
- Modify (likely): `internal/server/handlers_users.go`
- Test: `internal/server/handlers_users_test.go`

- [ ] **Step 1: Verify SHOW USERS columns match handler expectations**

Run: `grep -nE 'SHOW USERS|warnRowDrift' internal/server/handlers_users.go | head -10`
Expected: locate the column-pinning logic at ~L491. Compare against the columns Task 1's smoke test recorded.

- [ ] **Step 2: If schema drift, update column pin and add a regression test**

If `warnRowDrift("SHOW USERS", c)` shows a mismatch in the smoke output, update the pinned column list. Add:

```go
// TestSHOW_USERS_ColumnPinV0_5_15 asserts the handler accepts the v0.5.15
// SHOW USERS column set. If Geode adds a column, this test fires a warning
// (via warnRowDrift). If a column is renamed, the test fails — adjust the
// handler's column map and update this test.
func TestSHOW_USERS_ColumnPinV0_5_15(t *testing.T) {
	expected := []string{"username", "email", "role", "is_active", "auth_version"} // from smoke test
	fake := &fakeDriver{cols: expected, rows: [][]any{{"alice", "a@x.io", "admin", true, int64(3)}}}
	// ... wire to ListUsers and assert response shape
}
```

- [ ] **Step 3: Verify CREATE USER stmt matches v0.5.15 grammar**

Read `handlers_users.go:89` — the current emit is `CREATE USER " + uname + " WITH EMAIL " + email`. v0.5.15 grammar is `CREATE USER <name> SET PASSWORD <string> [ EMAIL <string> ] [ ROLE <name> ]`. **The current handler's `WITH EMAIL` is wrong syntax for v0.5.15.** It must be `SET PASSWORD '...' EMAIL '...'` (or equivalent).

- [ ] **Step 4: Fix the emit + add a positive-path test**

Update the emitted stmt to:

```go
stmt := fmt.Sprintf("CREATE USER %s SET PASSWORD %s",
	quoteIdent(uname),
	quoteString(password))
if email != "" {
	stmt += " EMAIL " + quoteString(email)
}
if role != "" {
	stmt += " ROLE " + quoteIdent(role)
}
```

Use the existing `quoteIdent`/`quoteString` helpers in `internal/server/quoting.go` — do NOT roll your own. Refuse to `fmt.Sprintf` raw user input.

Add a test:

```go
func TestCreateUser_EmitsV0_5_15Grammar(t *testing.T) {
	fake := &fakeDriver{}
	srv := newTestServer(t, fake)
	req := postJSON(t, "/api/v1/users", `{"username":"alice","password":"p4ssphrase!!","email":"a@x.io","role":"user"}`)
	rec := httptest.NewRecorder()
	srv.CreateUser(rec, req)
	if !contains(fake.lastStmt, "CREATE USER alice SET PASSWORD 'p4ssphrase!!'") ||
	   !contains(fake.lastStmt, "EMAIL 'a@x.io'") ||
	   !contains(fake.lastStmt, "ROLE user") {
		t.Fatalf("emitted stmt does not match v0.5.15 grammar: %q", fake.lastStmt)
	}
}
```

- [ ] **Step 5: Repeat the audit for ALTER USER, DROP USER, GRANT ROLE forms**

For each:
- `ALTER USER … SET PASSWORD` → ensure quoted string literal, not bare value
- `ALTER USER … SET ROLE` → ensure quoted identifier
- `ALTER USER … ENABLE` / `DISABLE` → no args, just `ALTER USER <name> ENABLE`
- `DROP USER <name>` → optional `IF EXISTS`
- `GRANT ROLE <role> TO <user>` (this is a synonym for `ALTER USER SET ROLE` per the mapping table)

Add one positive test per form. Skim `handlers_users.go` lines 70-650 to locate each emit.

- [ ] **Step 6: Run tests**

Run: `scripts/run-go.sh test -race -run 'TestCreateUser|TestAlterUser|TestDropUser|TestSHOW_USERS' ./internal/server/...`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add internal/server/handlers_users.go internal/server/handlers_users_test.go
git commit -m "$(cat <<'EOF'
feat(server): align user admin handlers with Geode v0.5.15 GQL DDL grammar

- CREATE USER now emits "SET PASSWORD '...' EMAIL '...' ROLE <name>" per
  v0.5.15 grammar (was "WITH EMAIL" — legacy, never accepted upstream)
- ALTER USER variants confirmed against v0.5.15 SET PASSWORD/ROLE/ENABLE/DISABLE
- DROP USER supports IF EXISTS
- SHOW USERS column pin updated to match v0.5.15 result schema

References upstream docs/GQL_AUTH_DDL.md @ v0.5.15

Closes GAP-002, GAP-013 (SHOW USERS / admin DDL upstream-blocked)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Validate handlers_roles.go on v0.5.15

**Files:**
- Modify: `/data/home/benji/src/devnw/codepros/geode/geode-ui/internal/server/handlers_roles.go`
- Test: `internal/server/handlers_roles_test.go`

- [ ] **Step 1: Audit SHOW ROLES + CREATE ROLE + DROP ROLE emissions**

For each emit in `handlers_roles.go`:
- `SHOW ROLES` — confirm column pin matches smoke output
- `CREATE ROLE <name> [ SET DESCRIPTION '<text>' ]` — per v0.5.15 grammar
- `DROP ROLE <name> [ IF EXISTS ]`

Note built-in roles (`admin`, `user`, `readwrite`, `readonly`) are idempotent on CREATE — the server returns `"already exists: <name> (built-in)"`. The handler should treat this as a 200 (or 200 with note in body), not a 409.

- [ ] **Step 2: Write tests**

```go
func TestCreateRole_EmitsV0_5_15Grammar(t *testing.T) { ... }
func TestCreateRole_BuiltinIsIdempotent(t *testing.T) { ... }  // POST admin → 200 with note
func TestSHOW_ROLES_ColumnPin(t *testing.T) { ... }
func TestDropRole_IfExistsSwallowed(t *testing.T) { ... }
```

- [ ] **Step 3: Implement and run tests**

Run: `scripts/run-go.sh test -race -run 'TestCreateRole|TestDropRole|TestSHOW_ROLES' ./internal/server/...`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add internal/server/handlers_roles.go internal/server/handlers_roles_test.go
git commit -m "$(cat <<'EOF'
feat(server): align role admin handlers with Geode v0.5.15 GQL DDL grammar

CREATE/DROP ROLE now emit v0.5.15 syntax; built-in role create is treated
as idempotent (server returns acknowledgement, not error). SHOW ROLES
column pin updated. Custom role membership beyond built-ins is still
upstream-deferred per GQL_AUTH_DDL.md "Known Limitations" #2.

Closes GAP-003, GAP-014 (admin DDL upstream-blocked)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire grants + per-graph permissions in handlers_grants.go

**Files:**
- Modify: `/data/home/benji/src/devnw/codepros/geode/geode-ui/internal/server/handlers_grants.go`
- Test: `internal/server/handlers_grants_test.go`

- [ ] **Step 1: Read the current handler shape**

Run: `grep -nE 'GRANT|REVOKE|SHOW PERMISSIONS' internal/server/handlers_grants.go internal/server/handlers_policies.go`
Expected: locate the existing emits; v0.5.15 supports `GRANT READ|WRITE|SCHEMA|ALL [ ON GRAPH <name> ] TO <user>` and reverse `REVOKE … FROM <user>`.

- [ ] **Step 2: Write tests**

```go
// per the v0.5.15 grammar; per-graph grants are persisted and additive.
func TestGrant_PerGraphReadGrant(t *testing.T) {
	// POST /api/v1/grants {"user":"alice","action":"READ","graph":"movies"}
	// expect emitted stmt: GRANT READ ON GRAPH movies TO alice
}
func TestGrant_GlobalWriteReturnsExplanatoryNote(t *testing.T) {
	// POST /api/v1/grants {"user":"alice","action":"WRITE"} (no graph)
	// v0.5.15 returns an explanatory note that this is not persisted —
	// handler should pass that note through as 200 with a "note" field.
}
func TestRevoke_RemovesGrant(t *testing.T) { ... }
func TestShowPermissions_ForOther_RequiresAdmin(t *testing.T) {
	// non-admin caller hitting GET /api/v1/grants?for=otheruser → 403
}
func TestShowPermissions_Self(t *testing.T) {
	// non-admin caller hitting GET /api/v1/grants (no for) → own perms
}
```

- [ ] **Step 3: Implement emits**

```go
// emit shape per docs/GQL_AUTH_DDL.md @ v0.5.15:
//   GRANT  READ|WRITE|SCHEMA|ALL [ ON GRAPH <name> ] TO <user>
//   REVOKE READ|WRITE|SCHEMA|ALL [ ON GRAPH <name> ] FROM <user>
stmt := fmt.Sprintf("GRANT %s", action) // action ∈ READ/WRITE/SCHEMA/ALL — validate against allowlist
if graph != "" {
	stmt += " ON GRAPH " + quoteIdent(graph)
}
stmt += " TO " + quoteIdent(user)
```

Action allowlist must be enforced in handler (don't trust JSON). Use a switch over a typed enum, default 422.

- [ ] **Step 4: Document the global-grant limitation in the handler**

Add a Godoc paragraph above the grant handler citing GQL_AUTH_DDL.md "Known Limitations" #1: global per-privilege grants are not persisted, only per-graph. The handler should pass the server's explanatory note through to the client.

- [ ] **Step 5: Run tests**

Run: `scripts/run-go.sh test -race -run 'TestGrant|TestRevoke|TestShowPermissions' ./internal/server/...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/server/handlers_grants.go internal/server/handlers_grants_test.go
git commit -m "$(cat <<'EOF'
feat(server): wire per-graph GRANT/REVOKE + SHOW PERMISSIONS (Geode v0.5.15)

- GRANT READ|WRITE|SCHEMA|ALL ON GRAPH <g> TO <u> persisted upstream
- REVOKE mirror
- SHOW PERMISSIONS FOR <u> requires admin; SHOW PERMISSIONS (self) does not
- Global (no-graph) grants documented as not-persisted per upstream
  "Known Limitations" #1; explanatory note passed through to client

Closes GAP-013, GAP-014 (admin DDL upstream-blocked, grants subset)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Document upstream-deferred items in handlers_policies.go

**Files:**
- Modify: `/data/home/benji/src/devnw/codepros/geode/geode-ui/internal/server/handlers_policies.go`

- [ ] **Step 1: Read current shape**

Run: `cat internal/server/handlers_policies.go`
Expected: handler emits some form of `CREATE POLICY`; v0.5.15 does NOT support this per GQL_AUTH_DDL.md "Known Limitations" #3 and #7. The wire_feature_missing fallback is correct and must stay until a future Geode release.

- [ ] **Step 2: Add a Godoc paragraph linking to upstream's future grammar**

Add to the handler's docstring:

```go
// CreatePolicy is a placeholder for the future GQL CREATE POLICY syntax
// (see ~/src/devnw/codepros/geode/geode/docs/GQL_AUTH_DDL.md "Future:
// CREATE POLICY"). Until Geode lands this, the call returns
// wire_feature_missing and the SPA gates the CTA via admin_writable.policies
// (which Task 3 reports as false on v0.5.15). Do not remove the
// wire_feature_missing fallback here.
```

- [ ] **Step 3: Add a regression test asserting the fallback**

```go
func TestCreatePolicy_StaysWireFeatureMissingOnV0_5_15(t *testing.T) {
	fake := &fakeDriver{err: &mockWireFeatureMissingError{}}
	// POST /api/v1/policies → 422 wire_feature_missing
}
```

- [ ] **Step 4: Commit**

```bash
git add internal/server/handlers_policies.go internal/server/handlers_policies_test.go
git commit -m "docs(server): document CREATE POLICY as still upstream-deferred per GQL_AUTH_DDL.md"
```

---

## Task 8: Unskip e2e/specs/07-admin-users.spec.ts

**Files:**
- Modify: `/data/home/benji/src/devnw/codepros/geode/geode-ui/e2e/specs/07-admin-users.spec.ts`

- [ ] **Step 1: Read the spec**

Run: `cat e2e/specs/07-admin-users.spec.ts | head -120`
Expected: locate the `test.skip` or upstream-blocked probes at L27, L49, L75, L83.

- [ ] **Step 2: Remove the skip guards and run against the local stack**

Strip the `test.skip` / `test.fixme` directives. Run:

```bash
make e2e-ci -- e2e/specs/07-admin-users.spec.ts
```

(Or whatever the project's e2e command is. Check `Makefile`/`package.json`.)
Expected: tests pass against a fresh v0.5.15-backed stack.

- [ ] **Step 3: If a test fails, capture the diff**

Save the Playwright trace + screenshot as evidence. The failure is either:
- A row-shape mismatch (handler change in Task 4 didn't pin correctly)
- A 422 wire_feature_missing leaking through (Geode build is < v0.5.15)
- A SPA gate stale (capabilities not yet refreshed — check Task 3 propagated to `useCapabilities`)

Fix forward, don't re-skip.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/07-admin-users.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): unskip 07-admin-users (Geode v0.5.15 enables SHOW USERS + CREATE/DROP USER)

Probes that previously returned wire_feature_missing now succeed against
the v0.5.15 driver. Closes GAP-002 / GAP-013 by pinning the live flow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Unskip e2e/specs/08-admin-roles-policies.spec.ts

**Files:**
- Modify: `/data/home/benji/src/devnw/codepros/geode/geode-ui/e2e/specs/08-admin-roles-policies.spec.ts`

- [ ] **Step 1: Read the spec at L4-13 (upstream-blocked guard)**

Run: `head -30 e2e/specs/08-admin-roles-policies.spec.ts`
Expected: identify the `test.skip` for the roles section.

- [ ] **Step 2: Unskip the role tests, keep the policy tests skipped**

The roles surface is enabled by v0.5.15. The policies surface is NOT (per Task 7). So split the file's skip directive: unskip the `describe('roles', ...)` block, keep the `describe('policies', ...)` block skipped with an updated reason: `test.fixme(true, 'policies (CREATE POLICY) still upstream-deferred; see docs/GQL_AUTH_DDL.md')`.

- [ ] **Step 3: Run**

```bash
make e2e-ci -- e2e/specs/08-admin-roles-policies.spec.ts
```

Expected: roles tests pass, policies tests fixme-skipped with the new reason in the report.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/08-admin-roles-policies.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): unskip 08-admin-roles (Geode v0.5.15 enables SHOW ROLES + DDL)

Roles describe block now runs. Policies describe stays fixme'd —
CREATE POLICY is upstream-deferred per docs/GQL_AUTH_DDL.md.

Closes GAP-003 / GAP-014 (roles subset). Policies tracked separately.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Audit ops + audit-role spec (e2e/specs/09-ops.spec.ts)

**Files:**
- Modify: `/data/home/benji/src/devnw/codepros/geode/geode-ui/e2e/specs/09-ops.spec.ts`

- [ ] **Step 1: Read the spec at L37-47**

Run: `sed -n '30,55p' e2e/specs/09-ops.spec.ts`
Expected: see the "audit role" probe and its skip guard.

- [ ] **Step 2: Determine if audit-role is now live in v0.5.15**

Search the v0.5.15 GQL_AUTH_DDL.md for "audit". If audit-role is part of the built-in role set (it is — `admin`, `user`, `readwrite`, `readonly`; **audit is NOT a built-in role**), then GAP-004 stays upstream-blocked. Update the spec's skip reason to point at the current limitation rather than a generic "upstream-blocked".

- [ ] **Step 3: Update reason if still blocked**

If audit-role isn't shipped, leave the test skipped with a precise message:

```typescript
test.fixme(true, 'audit role not in v0.5.15 built-in set; tracked as future Geode work (GAP-004)');
```

If audit-role IS shipped (verify by listing built-in roles from Task 1's smoke output for `SHOW ROLES`), unskip and rerun.

- [ ] **Step 4: Commit (skip-reason refresh or unskip)**

```bash
git add e2e/specs/09-ops.spec.ts
git commit -m "test(e2e): refresh 09-ops audit-role skip reason for Geode v0.5.15"
```

---

## Task 11: Refresh MCP tools/list probe (e2e/specs/10-mcp-endpoint.spec.ts)

**Files:**
- Modify: `/data/home/benji/src/devnw/codepros/geode/geode-ui/e2e/specs/10-mcp-endpoint.spec.ts`

- [ ] **Step 1: Check MCP tools/list in v0.5.15**

Run: `cd ~/src/devnw/codepros/geode/geode && git show v0.5.15 -- 'src/**/mcp*' 2>&1 | head -50`
Expected: MCP tools/list is NOT part of v0.5.15 (commits are all auth DDL + CI). The probe at L124-127 stays skipped.

- [ ] **Step 2: Refresh skip reason to cite v0.5.15 explicitly**

```typescript
test.fixme(true, 'MCP tools/list not in Geode v0.5.15 (CI/auth DDL release); tracked GAP-005');
```

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/10-mcp-endpoint.spec.ts
git commit -m "test(e2e): refresh 10-mcp tools/list skip reason for Geode v0.5.15"
```

---

## Task 12: Update geode-ui docs (README, ARCHITECTURE)

**Files:**
- Modify: `/data/home/benji/src/devnw/codepros/geode/geode-ui/README.md`
- Modify: `/data/home/benji/src/devnw/codepros/geode/geode-ui/docs/ARCHITECTURE.md`

- [ ] **Step 1: Bump README "requires Geode" minimum**

Find the line in README that mentions Geode minimum version (likely in Prerequisites or Compatibility section). Update to `Geode ≥ v0.5.15 for admin DDL + role + grant management; v0.5.x older releases work for read-only query flows`.

- [ ] **Step 2: Add an Admin DDL paragraph to README**

Under the existing Architecture section, add 2-3 sentences pointing at `~/src/devnw/codepros/geode/geode/docs/GQL_AUTH_DDL.md` for the upstream syntax reference and noting that the SPA gates CTAs by probing `SHOW CAPABILITIES`.

- [ ] **Step 3: Update docs/ARCHITECTURE.md "Auth model" section**

Add a subsection: "Server-side admin DDL (Geode v0.5.15+)" listing the supported operations and noting which are persisted vs ephemeral (per the "Known Limitations" in upstream docs).

- [ ] **Step 4: Commit**

```bash
git add README.md docs/ARCHITECTURE.md
git commit -m "docs: document Geode v0.5.15 admin DDL surface (auth-ddl-integration plan)"
```

---

## Task 13: Update GAP_ANALYSIS docs

**Files:**
- Modify: `/data/home/benji/src/devnw/codepros/geode/geode-ui/docs/GAP_ANALYSIS.md`
- Modify: `/data/home/benji/src/devnw/codepros/geode/geode-ui/docs/GAP_ANALYSIS_RESOLVED.md`
- Modify: `/data/home/benji/src/devnw/codepros/geode/geode-ui/docs/QUALITY_GAP_ANALYSIS.md`

- [ ] **Step 1: Move closed gaps to RESOLVED**

For each of GAP-002, GAP-003, GAP-013, GAP-014, append a block to `GAP_ANALYSIS_RESOLVED.md` with:
- Closure date: 2026-05-13
- Commits: (from tasks 4-10 above)
- Evidence: e2e spec un-skip + handler test pin
- Upstream version: Geode v0.5.15

Remove the corresponding rows from `GAP_ANALYSIS.md` open table (move them, don't duplicate).

- [ ] **Step 2: Refresh remaining upstream-blocked gaps**

GAP-004, GAP-005, GAP-015, GAP-016 — update the skip reason from "upstream-blocked on Geode v0.6+" to:
- GAP-004 / GAP-015: "upstream-deferred — audit role not yet shipped (verified v0.5.15)"
- GAP-005 / GAP-016: "upstream-deferred — MCP tools/list not yet shipped (verified v0.5.15)"

- [ ] **Step 3: Close Q53 #198**

In `docs/QUALITY_GAP_ANALYSIS.md` 2026-05-13 cohort table, mark Q53 #198 row as `**resolved** (Task 3 — handler probes SHOW CAPABILITIES + SHOW VERSION)`.

- [ ] **Step 4: Commit**

```bash
git add docs/GAP_ANALYSIS.md docs/GAP_ANALYSIS_RESOLVED.md docs/QUALITY_GAP_ANALYSIS.md
git commit -m "$(cat <<'EOF'
docs(gap): close GAP-002/003/013/014 + Q53 — Geode v0.5.15 unblocks admin DDL

Moved 4 admin gaps from open → RESOLVED with v0.5.15 commit references.
Refreshed upstream-deferred skip reasons for GAP-004/005/015/016 (audit
role + MCP tools/list verified absent in v0.5.15 surface).

Q53 #198 (handlers_capabilities hardcoded false) closed by Task 3
SHOW CAPABILITIES probe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Final validation + push

**Files:** (none modified)

- [ ] **Step 1: Run the full Go test suite**

```bash
scripts/run-go.sh test -race -cover -failfast ./...
```

Expected: PASS, coverage ≥ baseline.

- [ ] **Step 2: Run go-lint**

```bash
make go-lint
```

Expected: 0 issues.

- [ ] **Step 3: Run web-test + web-lint + tsc**

```bash
make web-test && make web-lint && npm run test:ts && npm run prettier:check
```

Expected: PASS on all four.

- [ ] **Step 4: Run e2e specs 07, 08 against a real v0.5.15 stack**

```bash
make e2e-ci -- e2e/specs/07-admin-users.spec.ts e2e/specs/08-admin-roles-policies.spec.ts
```

Expected: PASS (verifies the un-skip + handler changes light up end-to-end).

- [ ] **Step 5: Push the branch**

Only after user approval (per the project's "no auto-push" policy):

```bash
git push origin HEAD
```

- [ ] **Step 6: Close GitLab issues with evidence**

For each of #198 (Q53), GAP-002, GAP-003, GAP-013, GAP-014:

```bash
glab issue close <id> --comment "Closed by Geode v0.5.15 auth DDL integration (see commits <sha-range>). Evidence: e2e specs 07-08 unskipped and passing; handlers_capabilities now probes SHOW CAPABILITIES; handlers_users/roles/grants pinned to v0.5.15 grammar. Plan: docs/superpowers/plans/2026-05-13-geode-0-5-15-auth-ddl-integration.md."
```

---

## Won't-do in this plan

- **CREATE POLICY** / RLS UI surface — upstream-deferred per Limitations #3 / #7. Tracked separately.
- **MCP tools/list endpoint** — not in v0.5.15; GAP-005/016 stay open with refreshed skip reason.
- **Audit role** — not in v0.5.15 built-in role set; GAP-004/015 stay open with refreshed skip reason.
- **Custom role membership on user records** — v0.5.15 known limitation #2 (role field tracks built-ins only). When upstream lands this, file as a follow-up.
- **No `SHOW GRANTS` endpoint** — v0.5.15 limitation #5. Skip until upstream lands `SHOW GRANTS [ FOR <user> ]`.
- **`SHOW PERMISSIONS FOR <user>` admin gate** — handled in Task 6; relies on the existing genapi `required_roles:["admin"]` route gate already in `geode.json`.
- **Bumping `geode-client-go`** — not needed for v0.5.15 (driver passes GQL strings; no protocol-level changes). Confirm with Task 1 smoke test.

---

## Coordination notes

- **Bundle D (GraphView split #192)** is in flight. This plan touches `internal/server/*.go` and `e2e/specs/*.ts` and `docs/*.md` — disjoint from Bundle D's `src/components/results/graph/*.tsx`. Doc table overlap (`docs/QUALITY_GAP_ANALYSIS.md`, `docs/GAP_ANALYSIS.md`) will resolve cleanly with `git rebase` if Bundle D lands first. Recommend executing this plan AFTER Bundle D's last commit lands to keep blame clean.
- **No `gen/` edits required** unless `geode.json` grows a `geode_version` field on `/api/v1/capabilities`. If yes, edit `geode.json` then run `make generate` (the upstream genapi is at `~/src/devnw/go/genapi`); commit the regenerated `gen/` files separately with a `chore(gen): regen for capabilities response shape` message.
- **Per CLAUDE.md memory rules:** never hand-edit `gen/`. If the regeneration produces diffs you didn't expect, fix `geode.json` or upstream `~/src/devnw/go/genapi`, not the emitted code.
