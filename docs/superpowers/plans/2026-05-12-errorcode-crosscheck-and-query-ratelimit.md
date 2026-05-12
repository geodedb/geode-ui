# Error-Code Cross-Check + `/api/v1/query` Rate-Limit Alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Close the silent-drift gap between the server's error-code taxonomy (`internal/server/errorcodes.go`) and the small set of error-code strings the SPA branches on (`src/api/capabilities.ts`), via a named seam + an automated cross-check. (B) Resolve issue #159 by aligning the generated per-route rate limit for `POST /api/v1/query` (currently `200` rps) with the documented ~2000-rps SLO in `docs/ARCHITECTURE.md`.

**Architecture:**
- **(A)** Today `src/api/capabilities.ts` hard-codes the literal `'wire_feature_missing'` in two places to detect the server's HTTP-501 wire-feature-missing response. The server emits that code from `internal/server/errorcodes.go` (constant `ErrCodeWireFeatureMissing`). If either side's value drifts, the SPA's detection silently breaks and there's no test. Fix: introduce `src/api/serverErrorCodes.ts` — a tiny module that names the server error codes the SPA branches on (today: just `WIRE_FEATURE_MISSING`); refactor `capabilities.ts` to import from it; add `scripts/check-error-codes.mjs` which parses `errorcodes.go` for `ErrCode* = "value"` pairs and asserts every value exported from `serverErrorCodes.ts` exists in that set; wire the script into `.pre-commit-config.yaml` and a CI lint job (mirroring the existing `scripts/check-ci-pins.sh` pattern). Also correct the now-inaccurate "the SPA keys i18n messages off it" comment in `errorcodes.go` (the SPA does not have an `errors.<code>` i18n map — it renders `error_description` verbatim and only *branches* on a couple of codes).
- **(B)** `geode.json` is the genapi spec; `make generate` emits `gen/api/handlers_gen.go` where `POST /api/v1/query`'s token-bucket is `securex.NewBucket(<geode.json rateLimit>, opts.GlobalBurst)`. The spec currently says `rateLimit: 200`; the global default (`GlobalRate`) is `2000`; `docs/ARCHITECTURE.md` documents the assumed steady-state target as ~2000 rps on `/api/v1/query`, and the connection pool (F11) was sized for that. So `200` throttles the route ~10× below documented capacity. Resolution: set `geode.json`'s `POST /api/v1/query` `rateLimit` to `2000` (matches `GlobalRate`'s default; the per-route bucket remains an upper bound — operators who lower `GlobalRate` at runtime are still capped correctly), regenerate `gen/`, pin the spec value with a test, update the docs, close #159. A deliberate alignment with the documented SLO; trivially reverted if a product owner later decides `200` was intentional.

**Tech Stack:** Go 1.26.x (`GOEXPERIMENT=jsonv2`; build/test via `make` targets only — never bare `go`), genapi codegen (`make generate`), Node ESM scripts (`scripts/*.mjs`, run by the `npm`/pre-commit toolchain), `pre-commit` hooks, GitLab CI.

**Repo conventions to honor:**
- `gen/` is genapi OUTPUT — never hand-edit; regenerate via `make generate` and commit the result in the same commit as the `geode.json` change (the pre-push hook `scripts/check-generate.sh` fails on any `gen/` diff vs. `geode.json`).
- `gopls`/IDE Go diagnostics are noisy in this repo (the LSP doesn't run with `GOEXPERIMENT=jsonv2`) — ignore them; trust the `make` targets.
- Node scripts: ESM `.mjs` with a `main()`, `process.exitCode = 1` on failure, clear stderr; no extra deps. The repo already has `scripts/check-ci-pins.sh`, `scripts/check-hardcoded-styles.mjs`, `scripts/detect-hardcoded-strings.mjs`, etc. — follow that style. **Make the core logic a pure exported function** (`checkErrorCodes(root) → { ok, problems[] }`) so it's unit-testable without spawning a subprocess; `main()` is a thin wrapper that calls it and sets `process.exitCode`.
- Pre-commit: hooks live in `.pre-commit-config.yaml` as `repo: local` entries; mirror the `check-ci-pins` entry added in a prior batch (match its `language:`/`entry:` shape).
- Conventional-commit messages (a `commitizen` `commit-msg` hook enforces the type list — `feat`/`fix`/`refactor`/`chore`/`ci`/`docs`/`test` etc.; combined types like `ci+docs` are rejected — pick one type per commit).
- Do NOT push. GitLab issue closure + `docs/*GAP_ANALYSIS*.md` updates are Task 9 (or hand them to a `gap-closer-reporter` step if this plan runs inside a larger `/codepros:gap-close`).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/api/serverErrorCodes.ts` | **create** | Single source of truth for the server error-code string values the SPA branches on (today: `WIRE_FEATURE_MISSING = 'wire_feature_missing'`). One named `export const` per code. |
| `src/api/capabilities.ts` | **modify** | Replace the two hard-coded `'wire_feature_missing'` literals with `WIRE_FEATURE_MISSING` imported from `serverErrorCodes.ts`. |
| `src/api/serverErrorCodes.test.ts` | **create** | Unit test: every export is a non-empty snake_case string; `WIRE_FEATURE_MISSING === 'wire_feature_missing'`. |
| `scripts/check-error-codes.mjs` | **create** | Exports `checkErrorCodes(root) → { ok: boolean, problems: string[], serverCodeCount: number, frontendCodeCount: number }`; `main()` calls it, prints, sets `process.exitCode`. Parses `internal/server/errorcodes.go` for `ErrCode* = "value"` → Set; parses `src/api/serverErrorCodes.ts` for exported string consts; reports any frontend value not in the server Set, and a missing/empty `serverErrorCodes.ts`. |
| `scripts/check-error-codes.test.mjs` | **create** | `node --test` spec that imports `checkErrorCodes`, builds tmpdir fixtures, asserts in-sync → `ok:true`, drifted → `ok:false` with the offending value in `problems`, empty TS → `ok:false`. (No subprocess; calls the function directly.) |
| `.pre-commit-config.yaml` | **modify** | Add a `check-error-codes` local hook (fires when `internal/server/errorcodes.go` or `src/api/serverErrorCodes.ts` change). |
| `.gitlab-ci.yml` | **modify** | Add an `error-codes-check` lint job running `node scripts/check-error-codes.mjs` (mirror the `ci-pins-check` job). |
| `internal/server/errorcodes.go` | **modify** | Correct the file-header doc comment ("the SPA keys i18n messages off it" → accurate wording: the SPA renders `error_description` verbatim and branches on a small subset — see `src/api/serverErrorCodes.ts`). Verify `ErrCodeWireFeatureMissing = "wire_feature_missing"` exists (Task 3 Step 5; if the server's 501 path uses a different value, the plan adapts there + Task 8). |
| `geode.json` | **modify** | `POST /api/v1/query` route: `rateLimit` `200` → `2000`. |
| `gen/api/handlers_gen.go` (+ any other regenerated `gen/*`) | **regenerated** | Via `make generate` after the `geode.json` change — committed alongside it. |
| `internal/server/query_ratelimit_test.go` | **create** | Pins `geode.json`'s `POST /api/v1/query` `rateLimit` to `2000` (parses `../../geode.json`). |
| `docs/ARCHITECTURE.md` | **modify** | Replace the "#159 open question" bullet with a one-line statement that the `/api/v1/query` per-route rate limit is aligned to the ~2000-rps target (resolved 2026-05-12). |
| `docs/PERF_GAP_ANALYSIS.md`, `docs/GAP_ANALYSIS.md`, `docs/GAP_ANALYSIS_RESOLVED.md`, `docs/QUALITY_GAP_ANALYSIS.md` | **modify** (Task 9) | Mark #159 closed; mark the error-code cross-check follow-up done; move resolved entries. |

The two features are independent — Tasks 1–3 (cross-check) and Tasks 4–8 (#159) can be done/PR'd separately. Task 9 (docs + issue closure) covers both.

---

## Task 1: `serverErrorCodes.ts` — the named seam

**Files:**
- Create: `src/api/serverErrorCodes.ts`
- Create: `src/api/serverErrorCodes.test.ts`

- [ ] **Step 1: Write the failing test**

`src/api/serverErrorCodes.test.ts`:
```ts
import * as codes from './serverErrorCodes'

describe('serverErrorCodes', () => {
  it('every exported value is a non-empty snake_case string', () => {
    const values = Object.values(codes)
    expect(values.length).toBeGreaterThan(0)
    for (const v of values) {
      expect(typeof v).toBe('string')
      expect(v).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('exports WIRE_FEATURE_MISSING with the server-contract value', () => {
    expect(codes.WIRE_FEATURE_MISSING).toBe('wire_feature_missing')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx jest src/api/serverErrorCodes.test.ts`
Expected: FAIL — `Cannot find module './serverErrorCodes'`.

- [ ] **Step 3: Create the module**

`src/api/serverErrorCodes.ts`:
```ts
// Server error-code string values the SPA branches on.
//
// The server's error-envelope `code` values are defined in
// internal/server/errorcodes.go (typed constants, e.g.
// `ErrCodeWireFeatureMissing = "wire_feature_missing"`). The SPA renders
// the server's `error_description` verbatim for display, but a couple of
// codes are *branched on* (e.g. wire-feature-missing -> render a clean
// "not supported by this Geode build" message instead of the raw 501
// body). Those codes are named here so there's one place coupled to the
// server contract -- and scripts/check-error-codes.mjs asserts every
// value in this file still exists in internal/server/errorcodes.go.
//
// Add a new entry here only when the SPA actually branches on a new
// server error code. Renaming a value is a breaking change on both sides.

/** Server returns this (HTTP 501) when the connected Geode build does not
 *  implement the requested DDL over the GQL wire. */
export const WIRE_FEATURE_MISSING = 'wire_feature_missing' as const
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npx jest src/api/serverErrorCodes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/serverErrorCodes.ts src/api/serverErrorCodes.test.ts
git commit -m "feat(api): add serverErrorCodes seam for server error-code coupling"
```

---

## Task 2: Refactor `src/api/capabilities.ts` to use the seam

**Files:**
- Modify: `src/api/capabilities.ts`

- [ ] **Step 1: Confirm the current literals**

Run: `grep -n "wire_feature_missing" src/api/capabilities.ts`
Expected: two hits — one in `isWireFeatureMissingError` (`body.error === 'wire_feature_missing'`) and one in a regex (`/wire_feature_missing/i`).

- [ ] **Step 2: Add the import and replace the literals**

At the top of `src/api/capabilities.ts`, add (next to the existing `import { client } from './client'`):
```ts
import { WIRE_FEATURE_MISSING } from './serverErrorCodes'
```

In `isWireFeatureMissingError`, replace:
```ts
  if (body && body.error === 'wire_feature_missing') return true
  if (typeof e.message === 'string') {
    if (/http status 501\b/i.test(e.message)) return true
    if (/wire_feature_missing/i.test(e.message)) return true
  }
```
with:
```ts
  if (body && body.error === WIRE_FEATURE_MISSING) return true
  if (typeof e.message === 'string') {
    if (/http status 501\b/i.test(e.message)) return true
    if (e.message.includes(WIRE_FEATURE_MISSING)) return true
  }
```
(`String.prototype.includes(WIRE_FEATURE_MISSING)` instead of a regex literal so there is no second hard-coded copy of the string; `WIRE_FEATURE_MISSING` is a plain identifier — no regex-escaping concerns.)

- [ ] **Step 3: Verify no hard-coded literal remains**

Run: `grep -n "'wire_feature_missing'\|/wire_feature_missing/" src/api/capabilities.ts`
Expected: no output.

- [ ] **Step 4: Run the affected tests + typecheck + lint**

Run: `npx jest src/api/capabilities src/components/admin/UsersPage.test.tsx src/components/admin/RolesPage.test.tsx src/components/admin/PoliciesPage.test.tsx`
Expected: PASS (wire-feature-missing detection behaves identically).

Run: `npm run test:ts`
Expected: exit 0.

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/api/capabilities.ts
git commit -m "refactor(api): branch wire-feature-missing detection off serverErrorCodes seam"
```

---

## Task 3: `scripts/check-error-codes.mjs` cross-check + its test + wiring + comment fix

**Files:**
- Create: `scripts/check-error-codes.mjs`
- Create: `scripts/check-error-codes.test.mjs`
- Modify: `.pre-commit-config.yaml`
- Modify: `.gitlab-ci.yml`
- Modify: `internal/server/errorcodes.go` (header comment only)

- [ ] **Step 1: Write the failing test for the script**

`scripts/check-error-codes.test.mjs`:
```mjs
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkErrorCodes } from './check-error-codes.mjs'

function fixture(goSrc, tsSrc) {
  const root = mkdtempSync(path.join(tmpdir(), 'errcodes-'))
  mkdirSync(path.join(root, 'internal', 'server'), { recursive: true })
  mkdirSync(path.join(root, 'src', 'api'), { recursive: true })
  writeFileSync(path.join(root, 'internal', 'server', 'errorcodes.go'), goSrc)
  writeFileSync(path.join(root, 'src', 'api', 'serverErrorCodes.ts'), tsSrc)
  return root
}

test('ok when every frontend code exists in errorcodes.go', () => {
  const root = fixture(
    `package server\nconst (\n\tErrCodeWireFeatureMissing = "wire_feature_missing"\n\tErrCodeNotFound = "not_found"\n)\n`,
    `export const WIRE_FEATURE_MISSING = 'wire_feature_missing' as const\n`,
  )
  try {
    const r = checkErrorCodes(root)
    assert.equal(r.ok, true, JSON.stringify(r.problems))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('not ok when a frontend code is missing from errorcodes.go', () => {
  const root = fixture(
    `package server\nconst (\n\tErrCodeNotFound = "not_found"\n)\n`,
    `export const WIRE_FEATURE_MISSING = 'wire_feature_missing' as const\n`,
  )
  try {
    const r = checkErrorCodes(root)
    assert.equal(r.ok, false)
    assert.ok(r.problems.some((p) => p.includes('wire_feature_missing')), JSON.stringify(r.problems))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('not ok when serverErrorCodes.ts is empty', () => {
  const root = fixture(
    `package server\nconst ( ErrCodeNotFound = "not_found" )\n`,
    `// empty\n`,
  )
  try {
    const r = checkErrorCodes(root)
    assert.equal(r.ok, false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('not ok when errorcodes.go parses to zero constants', () => {
  const root = fixture(
    `package server\n// no const block\n`,
    `export const WIRE_FEATURE_MISSING = 'wire_feature_missing' as const\n`,
  )
  try {
    const r = checkErrorCodes(root)
    assert.equal(r.ok, false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test scripts/check-error-codes.test.mjs`
Expected: FAIL — `Cannot find module './check-error-codes.mjs'` (all subtests error).

- [ ] **Step 3: Write the script**

`scripts/check-error-codes.mjs`:
```mjs
#!/usr/bin/env node
// Cross-check: every server error-code string the SPA branches on
// (exported from src/api/serverErrorCodes.ts) must exist as an
// `ErrCode* = "value"` constant in internal/server/errorcodes.go.
// Exit 1 with a clear message on any mismatch (or a missing/empty
// serverErrorCodes.ts, or a parse that yields zero server codes).
// Wired into pre-commit and CI.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// Parse `ErrCodeFoo = "foo_bar"` (Go const block). Returns Set<string> of values.
function goErrorCodeValues(src) {
  const out = new Set()
  const re = /\bErrCode\w+\s*=\s*"([^"]+)"/g
  let m
  while ((m = re.exec(src)) !== null) out.add(m[1])
  return out
}

// Parse `export const FOO = 'foo_bar' as const` / `export const FOO = "foo_bar"`.
// Returns Array<{name, value}>.
function tsExportedStringConsts(src) {
  const out = []
  const re = /export\s+const\s+(\w+)\s*=\s*(['"])([^'"]+)\2(?:\s+as\s+const)?/g
  let m
  while ((m = re.exec(src)) !== null) out.push({ name: m[1], value: m[3] })
  return out
}

function readMaybe(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

// Pure, testable. `root` is the repo root.
export function checkErrorCodes(root) {
  const goPath = path.join(root, 'internal', 'server', 'errorcodes.go')
  const tsPath = path.join(root, 'src', 'api', 'serverErrorCodes.ts')
  const problems = []

  const goSrc = readMaybe(goPath)
  if (goSrc === null) {
    return { ok: false, problems: [`cannot read ${goPath}`], serverCodeCount: 0, frontendCodeCount: 0 }
  }
  const tsSrc = readMaybe(tsPath)
  if (tsSrc === null) {
    return { ok: false, problems: [`cannot read ${tsPath}`], serverCodeCount: 0, frontendCodeCount: 0 }
  }

  const serverCodes = goErrorCodeValues(goSrc)
  if (serverCodes.size === 0) {
    problems.push(
      `parsed no ErrCode* constants from ${path.relative(root, goPath)} — ` +
        `parser or file shape changed; investigate`,
    )
  }

  const frontend = tsExportedStringConsts(tsSrc)
  if (frontend.length === 0) {
    problems.push(
      `${path.relative(root, tsPath)} exports no string constants — it must name ` +
        `the server error codes the SPA branches on (e.g. ` +
        `export const WIRE_FEATURE_MISSING = 'wire_feature_missing')`,
    )
  }

  for (const c of frontend) {
    if (serverCodes.size > 0 && !serverCodes.has(c.value)) {
      problems.push(
        `${path.relative(root, tsPath)}: ${c.name} = "${c.value}" is not declared ` +
          `as an ErrCode* constant in ${path.relative(root, goPath)} — fix one side so they match`,
      )
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    serverCodeCount: serverCodes.size,
    frontendCodeCount: frontend.length,
  }
}

function main() {
  // Default repo root: this script lives in <root>/scripts/.
  const idx = process.argv.indexOf('--root')
  const root = idx !== -1 && process.argv[idx + 1] ? path.resolve(process.argv[idx + 1]) : path.resolve(HERE, '..')

  const r = checkErrorCodes(root)
  if (!r.ok) {
    console.error('check-error-codes: FAILED')
    for (const p of r.problems) console.error(`  - ${p}`)
    process.exitCode = 1
    return
  }
  console.log(
    `check-error-codes: OK — ${r.frontendCodeCount} frontend-referenced code(s) ` +
      `all present in errorcodes.go (${r.serverCodeCount} server codes total)`,
  )
}

// Run main() only when invoked directly, not when imported by the test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
```

- [ ] **Step 4: Run the script's test to make sure it passes**

Run: `node --test scripts/check-error-codes.test.mjs`
Expected: PASS (4 subtests).

- [ ] **Step 5: Run the script against the real repo**

Run: `node scripts/check-error-codes.mjs`
Expected: `check-error-codes: OK — 1 frontend-referenced code(s) all present in errorcodes.go (...)`

If it FAILS with `wire_feature_missing` not declared in `errorcodes.go`: the server's 501 wire-feature-missing path emits a different code value (or none). Stop and run `grep -rn 'wire_feature_missing\|errWireFeatureMissing\|WireFeatureMissing\|StatusNotImplemented' internal/server/` to find the real value. Then **go to Task 8** (the contingency) — the most likely real fixes are: (a) the server emits a different value → update `WIRE_FEATURE_MISSING`'s value in `serverErrorCodes.ts` and the `body.error === ...` check in `capabilities.ts` to match (this cross-check just caught a real frontend bug), or (b) the server emits no `code` on the 501, only the HTTP status → there is no string-valued coupling to check, so drop the cross-check feature (Tasks 1–3) and keep only the `errorcodes.go` comment fix. (Most likely it just passes — the SPA's existing `body.error === 'wire_feature_missing'` check, exercised by the admin-page tests, strongly implies `ErrCodeWireFeatureMissing = "wire_feature_missing"` exists.)

- [ ] **Step 6: Wire into pre-commit + CI**

In `.pre-commit-config.yaml`, under the existing `repos: - repo: local` `hooks:` list (next to the `check-ci-pins` entry), add — **matching the `language:`/`entry:` shape used by the neighbouring hooks** (if `check-ci-pins` is `language: script` with `entry: scripts/check-ci-pins.sh`, this `.mjs` hook should be `language: node` / `entry: node scripts/check-error-codes.mjs`):
```yaml
      - id: check-error-codes
        name: error-code seam vs errorcodes.go
        entry: node scripts/check-error-codes.mjs
        language: node
        pass_filenames: false
        files: ^(internal/server/errorcodes\.go|src/api/serverErrorCodes\.ts)$
```

In `.gitlab-ci.yml`, in the `lint` stage near the `ci-pins-check` job, add — **matching that job's `extends:`/`image:`/`needs:` shape exactly**:
```yaml
error-codes-check:
  stage: lint
  extends: .node_defaults   # replace with whatever ci-pins-check extends
  script:
    - node scripts/check-error-codes.mjs
```

- [ ] **Step 7: Fix the inaccurate comment in `errorcodes.go`**

In `internal/server/errorcodes.go`, the header doc block contains a clause like "...the SPA keys i18n messages off it...". Replace just that clause with an accurate one (keep the rest — the golden-test description, the "do not change the byte value" warning — intact):
```go
// here as a typed constant. The SPA renders the server's
// `error_description` verbatim for display; it additionally *branches* on
// a small subset of these codes (e.g. wire-feature-missing -> a clean
// "not supported by this build" message) -- those codes are mirrored in
// src/api/serverErrorCodes.ts and scripts/check-error-codes.mjs asserts
// the mirror stays in sync. errorcodes_test.go is a golden test that ...
```

- [ ] **Step 8: Verify Go still builds/tests + the script runs in pre-commit**

Run: `make go-test`
Expected: PASS (comment change is a no-op for code; `errorcodes_test.go` still passes).

Run: `make go-lint`
Expected: 0 issues.

Run: `git add -A && pre-commit run check-error-codes`
Expected: Passed.

Run: `python3 -c 'import yaml; list(yaml.safe_load_all(open(".gitlab-ci.yml"))); print("CI-YAML-OK")'`
Expected: `CI-YAML-OK`.

- [ ] **Step 9: Commit**

```bash
git add scripts/check-error-codes.mjs scripts/check-error-codes.test.mjs .pre-commit-config.yaml .gitlab-ci.yml internal/server/errorcodes.go
git commit -m "test(server): cross-check serverErrorCodes seam against errorcodes.go + wire pre-commit/CI"
```

---

## Task 4: Pin & verify the `geode.json` `/api/v1/query` rate-limit value (test-first)

**Files:**
- Create: `internal/server/query_ratelimit_test.go`

- [ ] **Step 1: Confirm the current spec value & exact JSON shape**

Open `geode.json` and find the `POST /api/v1/query` route block. Note the exact shape: is it `{"routes": [{"method": "POST", "path": "/api/v1/query", "rateLimit": 200, ...}]}`? Or is the rate limit nested (`"rateLimit": {"rps": 200}`)? Or keyed differently (`"rate_limit"`)? The audit located it at ~line 53 as `"rateLimit": 200` on the query route. Record the path you'll assert on.

Run: `grep -n 'rateLimit\|/api/v1/query' geode.json`
Expected: shows the query route with `"rateLimit": 200`.

- [ ] **Step 2: Write the failing test**

`internal/server/query_ratelimit_test.go` — **adapt the struct to the real shape from Step 1**; this is the version for the `{"routes": [{"method","path","rateLimit"}]}` shape:
```go
package server

import (
	"encoding/json/v2"
	"os"
	"testing"
)

// TestGeodeJSONQueryRateLimit pins the per-route rate limit for
// POST /api/v1/query in the genapi spec to the documented ~2000-rps SLO
// (see docs/ARCHITECTURE.md). If a future spec edit drifts this value,
// this test fails -- forcing a deliberate decision and a docs update.
// Resolves #159.
func TestGeodeJSONQueryRateLimit(t *testing.T) {
	const want = 2000

	// geode.json lives at the repo root; this test runs from internal/server/.
	raw, err := os.ReadFile("../../geode.json")
	if err != nil {
		t.Fatalf("read geode.json: %v", err)
	}

	var spec struct {
		Routes []struct {
			Method    string `json:"method"`
			Path      string `json:"path"`
			RateLimit *int   `json:"rateLimit"`
		} `json:"routes"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("parse geode.json: %v", err)
	}

	var found bool
	for _, r := range spec.Routes {
		if r.Method == "POST" && r.Path == "/api/v1/query" {
			found = true
			if r.RateLimit == nil {
				t.Fatalf("POST /api/v1/query has no rateLimit in geode.json; want %d", want)
			}
			if *r.RateLimit != want {
				t.Fatalf("POST /api/v1/query rateLimit = %d; want %d (the documented ~2000-rps SLO -- see docs/ARCHITECTURE.md and #159)", *r.RateLimit, want)
			}
		}
	}
	if !found {
		t.Fatal("POST /api/v1/query route not found in geode.json -- spec shape changed; update this test")
	}
}
```
Use `encoding/json/v2` (the codec this repo uses) — or, if other ad-hoc parsing in `internal/server` tests uses the v1 `encoding/json`, match that. The assertion that matters: the `POST /api/v1/query` route's effective per-route rate limit is `2000`.

- [ ] **Step 3: Run it to make sure it fails**

Run: `make go-test 2>&1 | grep -A3 'TestGeodeJSONQueryRateLimit'`
Expected: FAIL — `POST /api/v1/query rateLimit = 200; want 2000`.
*(If you have the env set you can use `GOEXPERIMENT=jsonv2 GOTOOLCHAIN=go1.26.3 go test ./internal/server/ -run TestGeodeJSONQueryRateLimit -v`, but prefer the `make` path per repo convention.)*

- [ ] **Step 4: Commit the failing test** *(intentionally — it documents the gap; Task 5 makes it pass)*

```bash
git add internal/server/query_ratelimit_test.go
git commit -m "test(server): pin /api/v1/query rate limit to the documented 2000-rps SLO (#159)"
```
*(Acceptable alternative: skip this commit and fold the test into Task 5's commit — but the test must exist before the `geode.json` change so you see it go red then green.)*

---

## Task 5: Bump `geode.json` rate limit + regenerate `gen/`

**Files:**
- Modify: `geode.json` (`POST /api/v1/query` `rateLimit`: `200` → `2000`)
- Regenerated: `gen/api/handlers_gen.go` (and any other `gen/*` files `make generate` touches)

- [ ] **Step 1: Edit `geode.json`**

Change the `POST /api/v1/query` route's `"rateLimit": 200` to `"rateLimit": 2000`. Change *only* that value.

- [ ] **Step 2: Regenerate**

Run: `make generate`
Expected: `GENERATE_OK ...`; then `git status --short` shows changes only in `geode.json` and under `gen/` (plus possibly a no-op `go mod tidy`). If anything else is dirtied, investigate before continuing.

- [ ] **Step 3: Confirm the generated bucket changed**

Run: `grep -n 'bkt_post_Query\|NewBucket(2000' gen/api/handlers_gen.go`
Expected: a line like `bkt_post_Query = securex.NewBucket(2000, opts.GlobalBurst)` (the `200` is gone). The variable name may differ — the point is the `/api/v1/query` POST route's bucket now uses `2000`.

- [ ] **Step 4: Run the pin test — now it should pass**

Run: `make go-test 2>&1 | grep -A3 'TestGeodeJSONQueryRateLimit'`
Expected: no FAIL line for that test.

- [ ] **Step 5: Full Go gate**

Run: `make go-test`
Expected: PASS, all packages.

Run: `make go-lint`
Expected: 0 issues.

Run: `make generate` (again — must be idempotent)
Expected: `git status --short` shows nothing new under `gen/`.

Run: `make go-build && ./bin/geode-ui -h`
Expected: build OK, `-h` exits 0.

Run: `make bench-gate`
Expected: `PERF GATE OK` (unaffected by this change).

- [ ] **Step 6: Commit**

```bash
git add geode.json gen/
git commit -m "fix(api): align /api/v1/query per-route rate limit with the 2000-rps SLO (#159)"
```
*(If Task 4's failing-test commit was skipped, also `git add internal/server/query_ratelimit_test.go` here and say so in the message.)*

---

## Task 6: Update `docs/ARCHITECTURE.md` — remove the #159 open question

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Find the #159 bullet**

Run: `grep -n '159\|rateLimit\|rate.limit\|2000.rps\|open question' docs/ARCHITECTURE.md`
Expected: locates the "Performance SLOs (assumed, …)" section and the bullet noting `/api/v1/query rateLimit=200` vs ~2000-rps as an open question.

- [ ] **Step 2: Edit it**

Replace the "open question" bullet (something like *"Open question: `/api/v1/query` per-route `rateLimit=200` vs the ~2000-rps target (#159) — awaiting product clarification; deliberately NOT changed."*) with:
```markdown
- The `/api/v1/query` per-route rate limit is set to `2000` rps in
  `geode.json` (matching the assumed steady-state target above and the
  `GlobalRate` default); the per-route bucket is an upper bound, so
  lowering `GlobalRate` at runtime still throttles correctly. Pinned by
  `internal/server/query_ratelimit_test.go`. (Resolved 2026-05-12, #159 —
  was a documented open question; aligned to the SLO. If a future workload
  review shows `/api/v1/query` should be capped lower, change the spec
  value and update this line.)
```
Keep the rest of the Performance-SLOs section (assumed workload, the pprof note, the `make bench-gate` / baseline-refresh instructions) intact.

- [ ] **Step 3: Lint the markdown**

Run: `pre-commit run markdownlint --files docs/ARCHITECTURE.md` (or `npx markdownlint --config .markdownlint.json docs/ARCHITECTURE.md`)
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: record /api/v1/query rate-limit resolution in ARCHITECTURE.md (#159)"
```

---

## Task 7: Smoke-verify nothing else regressed

**Files:** *(none — verification only)*

- [ ] **Step 1: Frontend gate**

Run: `npm test`
Expected: PASS (test count up by `serverErrorCodes.test.ts`; everything else unchanged).

Run: `npm run test:ts && npm run lint && npm run prettier:check && npm run electron:tsc`
Expected: all exit 0 / clean.

- [ ] **Step 2: Go gate (final)**

Run: `make go-test && make go-lint && make generate`
Expected: tests PASS, lint 0 issues, `make generate` produces no diff (`git status --short` clean).

- [ ] **Step 3: Script + pre-commit gate**

Run: `node --test scripts/check-error-codes.test.mjs && node scripts/check-error-codes.mjs && bash scripts/check-ci-pins.sh`
Expected: all pass.

Run: `pre-commit run --all-files` (best-effort — if a pre-existing unrelated hook flags something not introduced here, note it; don't fix it in this plan)
Expected: `check-error-codes`, `check-ci-pins`, `markdownlint`, `gofmt`, `eslint`, `prettier` etc. pass on the changed files.

- [ ] **Step 4: Working-tree check**

Run: `git status`
Expected: clean (all commits made; no stray untracked files beyond `bin/`, `node_modules/`, etc.).

---

## Task 8: *(Contingency — only if Task 3 Step 5 showed the server emits a different / no `wire_feature_missing` code)*

Not a default step.

- [ ] **Step 1: Find the real server code (if any)**

Run: `grep -rn 'errWireFeatureMissing\|WireFeatureMissing\|wire_feature\|StatusNotImplemented\|501' internal/server/*.go`
Determine what `code` value (if any) the server's 501 wire-feature-missing response sets in its `{error, error_description}` body.

- [ ] **Step 2a — different value (e.g. `not_implemented`):** change `WIRE_FEATURE_MISSING`'s value in `src/api/serverErrorCodes.ts` and the `body.error === WIRE_FEATURE_MISSING` comparison in `src/api/capabilities.ts` to the real value. (`capabilities.ts` already reads the constant after Task 2 — no further structural change.) Re-run Task 2 Step 4's tests and Task 3 Step 5. Commit: `fix(api): correct wire-feature-missing error code to match server (caught by cross-check)`.

- [ ] **Step 2b — server emits no `code` on the 501 (HTTP status only):** remove the `body.error === WIRE_FEATURE_MISSING` line and the `e.message.includes(WIRE_FEATURE_MISSING)` line from `capabilities.ts` (HTTP 501 + the `/http status 501\b/` regex remain the detection). `src/api/serverErrorCodes.ts` then has nothing meaningful to export — delete `serverErrorCodes.ts`, `serverErrorCodes.test.ts`, `scripts/check-error-codes.mjs`, `scripts/check-error-codes.test.mjs`; revert the `.pre-commit-config.yaml` / `.gitlab-ci.yml` additions; keep only the `errorcodes.go` comment fix (re-point the "SPA branches on a subset" wording at `src/api/capabilities.ts`'s `isWireFeatureMissingError` instead of a `serverErrorCodes.ts`). Commit: `chore(server): correct errorcodes.go doc comment re: SPA usage`. Note in the execution report that the cross-check feature was dropped (no string-valued frontend↔server error-code coupling exists).

---

## Task 9: Tracking-doc updates + GitLab issue closure

**Files:**
- Modify: `docs/PERF_GAP_ANALYSIS.md`, `docs/GAP_ANALYSIS.md`, `docs/GAP_ANALYSIS_RESOLVED.md`, `docs/QUALITY_GAP_ANALYSIS.md`
- *(GitLab: close #159)*

> If this plan runs inside a larger `/codepros:gap-close`, hand this task to that workflow's `gap-closer-reporter` step instead.

- [ ] **Step 1: `docs/PERF_GAP_ANALYSIS.md`**

Find the `#159` / `PERF-2026-05-11-12` "awaiting product clarification" row. Mark it **Closed** — resolution: `/api/v1/query` `rateLimit` set to `2000` in `geode.json` (Task 5 commit SHA), pinned by `internal/server/query_ratelimit_test.go`, documented in `docs/ARCHITECTURE.md`. Move it per the file's existing format.

- [ ] **Step 2: `docs/QUALITY_GAP_ANALYSIS.md`**

Mark the "`src/lib/errors.ts` ↔ `errorcodes.go` cross-check" follow-up **Done** — resolution: `src/api/serverErrorCodes.ts` seam + `scripts/check-error-codes.mjs` + pre-commit/CI wiring (Tasks 1–3 commit SHAs); `errorcodes.go` header comment corrected. Note that there is no `src/lib/errors.ts` — the coupling lived in `src/api/capabilities.ts`.

- [ ] **Step 3: `docs/GAP_ANALYSIS.md` + `docs/GAP_ANALYSIS_RESOLVED.md`**

Add a "Gap-closure run — 2026-05-12 (errorcode cross-check + #159)" subsection in `GAP_ANALYSIS.md`; add the resolved entries (commit SHAs + test names) to `GAP_ANALYSIS_RESOLVED.md` per its format.

- [ ] **Step 4: Commit the docs**

```bash
git add docs/PERF_GAP_ANALYSIS.md docs/QUALITY_GAP_ANALYSIS.md docs/GAP_ANALYSIS.md docs/GAP_ANALYSIS_RESOLVED.md
git commit -m "docs: update gap-analysis tracking -- #159 closed + error-code cross-check landed"
```

- [ ] **Step 5: Close the GitLab issue**

Run:
```bash
glab issue note 159 -m "Closed by the /api/v1/query rate-limit alignment (geode.json rateLimit 200->2000, pinned by internal/server/query_ratelimit_test.go, documented in docs/ARCHITECTURE.md). Verified: make go-test / make go-lint / make generate clean / make bench-gate green; npm test green. The per-route bucket is an upper bound -- runtime GlobalRate still throttles below it."
glab issue close 159
```

---

## Self-Review Notes (already applied)

- **Spec coverage:** ✅ Both args covered — error-code cross-check (Tasks 1–3, contingency Task 8) and #159 (Tasks 4–6); Task 9 closes docs/issues; Task 7 is the regression gate.
- **Placeholders:** none — every code step has the actual code; the one genuine unknown (does `errorcodes.go` have `"wire_feature_missing"`?) is handled by Task 3 Step 5's branch + Task 8, with a committed default (`ErrCodeWireFeatureMissing = "wire_feature_missing"`, implied by the SPA's existing `body.error === 'wire_feature_missing'` check that the admin-page tests exercise).
- **Type/name consistency:** TS constant `WIRE_FEATURE_MISSING` throughout (Task 1 declares, Task 2 imports, Task 3's test uses); script function `checkErrorCodes(root)` throughout (Task 3 Step 1 test imports it, Step 3 exports it, `main()` calls it); Go test `TestGeodeJSONQueryRateLimit` throughout; script file `scripts/check-error-codes.mjs` throughout.
- **Independence:** Tasks 1–3 (frontend cross-check) and 4–6 (#159, Go/spec) touch disjoint files and can be separate PRs; Task 9 covers both.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-12-errorcode-crosscheck-and-query-ratelimit.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
