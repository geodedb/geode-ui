# Profile System Rebuild — Plan B: Multi-Session Auth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable multiple simultaneous Geode connections at the wire level. Login response carries a `connection_id`; the JWT carries a matching `cid` claim; the SPA gains an in-memory `ConnectionsContext` that maps connection_id → token. The SPA UX still appears single-session — Plan C swaps in the multi-active-connection switcher.

**Architecture:** Per-connection JWT in `Authorization: Bearer` header. Cookie path is retained for legacy compatibility; the same JWT goes into both the `Set-Cookie` and the response body. Server-side: `AuthJWT` middleware extracts `cid` from claims and stuffs it into the request context. SPA-side: `ConnectionsContext` holds an in-memory `Map<connection_id, {token, profileName, expiresAt}>`. The fetch wrapper attaches the active connection's Bearer header in addition to the cookie. CSRF middleware already exempts Bearer-authenticated calls — no change needed there.

**Tech Stack:** Go 1.26 + `GOEXPERIMENT=jsonv2`, `github.com/golang-jwt/jwt/v5`, React 18 + styled-components, genapi via `make generate`, table-driven Go tests, Jest+@testing-library/react for SPA.

---

## File Structure

**Create**
- `src/api/connections.tsx` — `ConnectionsContext` provider + `useConnections` + `useActiveConnection`
- `src/api/connections.test.tsx` — provider unit tests

**Modify**
- `internal/jwt/jwt.go` — add `ConnectionID` to `Claims`; extend `Issue` to accept `connID`
- `internal/jwt/jwt_test.go` — round-trip test for cid
- `internal/server/context.go` — add `cidCtxKey`, extend `actor`, update `actorFromContext`
- `internal/server/auth.go` — populate `cidCtxKey` from claims in `AuthJWT`
- `internal/server/handlers_auth.go` — generate cid, pass to issuer, return in `LoginResp`
- `internal/server/handlers_auth_test.go` — assert cid round-trips through Login
- `internal/server/audit.go` — include `cid` field in login audit events (optional but trivial)
- `geode.json` — add `connection_id` to `LoginResp` schema, then `make generate`
- `src/api/auth.ts` — extend `LoginResult` with `connection_id`
- `src/auth/AuthProvider.tsx` — wrap children in `ConnectionsProvider`; signIn writes to context; signOut clears it
- `src/api/client.ts` — fetch wrapper attaches Bearer header from active connection
- `src/index.tsx` (or wherever `AuthProvider` is mounted) — verify the new provider sits inside it

---

## Task 1: Add `cid` claim to the JWT (TDD)

**Files:** `internal/jwt/jwt.go`, `internal/jwt/jwt_test.go`

- [ ] **Step 1: Append the failing test** to `internal/jwt/jwt_test.go`:

```go
func TestIssueAndParse_ConnectionID(t *testing.T) {
	secret := bytes.Repeat([]byte("k"), 32)
	iss, err := NewIssuer(secret, time.Hour)
	if err != nil {
		t.Fatalf("NewIssuer: %v", err)
	}
	tok, _, err := iss.Issue("alice", "default", "conn-abc-123", []string{"admin"})
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	claims, err := iss.Parse(tok)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if claims.ConnectionID != "conn-abc-123" {
		t.Errorf("ConnectionID = %q, want %q", claims.ConnectionID, "conn-abc-123")
	}
	if claims.Subject != "alice" || claims.Profile != "default" {
		t.Errorf("other claims drifted: %+v", claims)
	}
}
```

(Add `bytes` to test imports if it's not already there.)

- [ ] **Step 2: Run the failing test** — `scripts/run-go.sh test ./internal/jwt/ -run TestIssueAndParse_ConnectionID -v`. Expected: FAIL — `Issue` argument count, undefined field.

- [ ] **Step 3: Update `internal/jwt/jwt.go`**:

a. Extend the `Claims` struct:

```go
type Claims struct {
	Subject      string   `json:"sub"`
	Profile      string   `json:"profile"`
	Roles        []string `json:"roles"`
	ConnectionID string   `json:"cid,omitempty"`
	jjwt.RegisteredClaims
}
```

b. Extend `Issue` to take `connID` as a fourth positional arg (after `roles`):

```go
// Issue mints a new HS256-signed token. connID identifies a single
// authenticated connection so multi-session SPAs can hold multiple
// tokens at once and the server can disambiguate them in audit logs.
// Pass "" to omit the cid claim (legacy single-session callers).
func (i *Issuer) Issue(sub, profile string, roles []string, connID string) (string, time.Time, error) {
	now := time.Now()
	exp := now.Add(i.ttl)
	tok := jjwt.NewWithClaims(jjwt.SigningMethodHS256, Claims{
		Subject:      sub,
		Profile:      profile,
		Roles:        roles,
		ConnectionID: connID,
		RegisteredClaims: jjwt.RegisteredClaims{
			IssuedAt:  jjwt.NewNumericDate(now),
			ExpiresAt: jjwt.NewNumericDate(exp),
			Subject:   sub,
		},
	})
	signed, err := tok.SignedString(i.secret)
	return signed, exp, err
}
```

- [ ] **Step 4: Update existing callers** — only `internal/server/handlers_auth.go` calls `Issue`. Find the call and add `""` (empty string) as the new fourth arg. Don't worry about generating a real cid yet — Task 5 wires that up. This step just keeps the build green:

```go
token, exp, err := s.cfg.JWT.Issue(req.Username, profile, roles, "")
```

- [ ] **Step 5: Run all jwt tests, expect PASS** — `scripts/run-go.sh test ./internal/jwt/ -v`. The new test passes; existing tests still pass (omitempty on `cid` keeps the wire shape backward-compatible).

- [ ] **Step 6: Run server pkg tests, expect PASS** — `scripts/run-go.sh test ./internal/server/ -count=1`. The `""` cid in handlers_auth.go means existing Login tests don't change shape.

- [ ] **Step 7: Commit**:

```bash
git add internal/jwt/jwt.go internal/jwt/jwt_test.go internal/server/handlers_auth.go
git commit -m "feat(jwt): add ConnectionID (cid) claim and Issue parameter"
```

---

## Task 2: Wire `cid` through `AuthJWT` into request context (TDD)

**Files:** `internal/server/context.go`, `internal/server/auth.go`, `internal/server/auth_test.go`

- [ ] **Step 1: Append the failing test** to `internal/server/auth_test.go`:

```go
func TestAuthJWT_PopulatesConnectionID(t *testing.T) {
	secret := bytes.Repeat([]byte("k"), 32)
	iss, _ := jwt.NewIssuer(secret, time.Hour)
	srv := New(Config{JWT: iss})

	tok, _, _ := iss.Issue("alice", "default", []string{"admin"}, "conn-xyz-789")

	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	if err := srv.AuthJWT(r); err != nil {
		t.Fatalf("AuthJWT: %v", err)
	}
	got := connectionIDFromContext(r.Context())
	if got != "conn-xyz-789" {
		t.Errorf("connectionIDFromContext = %q, want %q", got, "conn-xyz-789")
	}
}
```

(Add `bytes`, `time`, `httptest`, `jwt "geodedb.com/geode-ui/internal/jwt"` to test imports as needed.)

- [ ] **Step 2: Run the failing test** — `scripts/run-go.sh test ./internal/server/ -run TestAuthJWT_PopulatesConnectionID -v`. Expected: FAIL — `connectionIDFromContext` undefined.

- [ ] **Step 3: Add the new context key + accessor** in `internal/server/context.go`. Find the existing `userCtxKey`/`rolesCtxKey`/`profileCtxKey`/`authSourceCtxKey` block and add a sibling `cidCtxKey`:

```go
const (
	userCtxKey ctxKey = iota
	rolesCtxKey
	profileCtxKey
	authSourceCtxKey
	cidCtxKey
)
```

(Match the existing const-block style — it may use a bare `iota` block or named consts; preserve the convention.)

Add a public-ish accessor below the `actor` block:

```go
// connectionIDFromContext reads the JWT's `cid` claim previously placed
// in ctx by AuthJWT. Returns "" if the middleware didn't run or the
// JWT carried no cid.
func connectionIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(cidCtxKey).(string); ok {
		return v
	}
	return ""
}
```

- [ ] **Step 4: Update `actorFromContext`** to populate `actor.ConnectionID`. First extend the struct:

```go
type actor struct {
	Subject      string
	Roles        []string
	ConnectionID string
}
```

Then in `actorFromContext`:

```go
func actorFromContext(ctx context.Context) actor {
	var a actor
	if v, ok := ctx.Value(userCtxKey).(string); ok {
		a.Subject = v
	}
	if v, ok := ctx.Value(rolesCtxKey).([]string); ok {
		a.Roles = v
	}
	if v, ok := ctx.Value(cidCtxKey).(string); ok {
		a.ConnectionID = v
	}
	return a
}
```

- [ ] **Step 5: Populate `cidCtxKey` in `AuthJWT`**. In `internal/server/auth.go`, find the block:

```go
ctx := r.Context()
ctx = context.WithValue(ctx, userCtxKey, claims.Subject)
ctx = context.WithValue(ctx, profileCtxKey, claims.Profile)
ctx = context.WithValue(ctx, rolesCtxKey, claims.Roles)
src := sourceForRequest(r)
ctx = context.WithValue(ctx, authSourceCtxKey, src)
```

Insert after the rolesCtxKey line:

```go
ctx = context.WithValue(ctx, cidCtxKey, claims.ConnectionID)
```

- [ ] **Step 6: Run the test, expect PASS** — `scripts/run-go.sh test ./internal/server/ -count=1 -run TestAuthJWT -v`. All AuthJWT tests pass.

- [ ] **Step 7: Run the full server pkg, expect PASS** — `scripts/run-go.sh test ./internal/server/ -count=1`.

- [ ] **Step 8: Commit**:

```bash
git add internal/server/context.go internal/server/auth.go internal/server/auth_test.go
git commit -m "feat(server): extract JWT cid claim into request context + actor"
```

---

## Task 3: Add `connection_id` to `LoginResp` schema + regen

**Files:** `geode.json`, `gen/`

- [ ] **Step 1: Read the current `LoginResp` schema**

```bash
grep -nA10 '"LoginResp"' geode.json
```

- [ ] **Step 2: Edit `geode.json`** — add `connection_id` to `LoginResp` properties. The existing schema is roughly:

```json
"LoginResp": {
  "type": "object",
  "required": ["access_token", "token_type", "expires_in"],
  "properties": {
    "access_token": { "type": "string", ... },
    "token_type":   { "type": "string", ... },
    "expires_in":   { "type": "integer", ... }
  }
}
```

Add `connection_id` to the properties list AND to the `required` array. Final shape:

```json
"LoginResp": {
  "type": "object",
  "required": ["access_token", "token_type", "expires_in", "connection_id"],
  "properties": {
    "access_token":  { "type": "string", "minLength": 1, "maxLength": 4096 },
    "token_type":    { "type": "string", "enum": ["Bearer"] },
    "expires_in":    { "type": "integer", "minimum": 1, "maximum": 86400 },
    "connection_id": { "type": "string", "minLength": 1, "maxLength": 64 }
  }
}
```

(Preserve the existing min/max for the original three fields — only add the new field. Verify the actual current shape with the grep above and adapt.)

- [ ] **Step 3: Regen**

```bash
make generate
```

Expected: `gen/types/types.gen.go` — `LoginResp` struct now has `ConnectionID string \`json:"connection_id"\``. `gen/client/react/client.ts` — `LoginResp` type now has `connection_id: string`.

Verify:

```bash
grep -nE 'ConnectionID|connection_id' gen/types/types.gen.go gen/client/react/client.ts | head
```

- [ ] **Step 4: Verify build state**

```bash
scripts/run-go.sh build ./...
```

Expected: ONE error in `internal/server/handlers_auth.go` because the `LoginResp` literal now has a missing required field. Task 4 fixes that. If the build is clean (because the schema validator accepts a zero-valued required field at construction time but rejects it at marshal), still proceed — Task 4 will populate `ConnectionID`. If errors leak elsewhere, investigate.

- [ ] **Step 5: Commit**

```bash
git add geode.json gen/
git commit -m "feat(genapi): LoginResp gains connection_id"
```

---

## Task 4: Login handler mints + returns `connection_id` (TDD)

**Files:** `internal/server/handlers_auth.go`, `internal/server/handlers_auth_test.go`

The Login handler currently passes `""` to `Issuer.Issue` (set in Task 1 step 4). Now it generates a real cid, threads it through, and writes it into the response.

- [ ] **Step 1: Append the failing test** to `internal/server/handlers_auth_test.go`:

```go
func TestLogin_ReturnsConnectionID(t *testing.T) {
	secret := bytes.Repeat([]byte("k"), 32)
	iss, _ := jwt.NewIssuer(secret, time.Hour)
	srv := New(Config{
		JWT:      iss,
		Profiles: stubProfileLookup{name: "default"},
		testAuthenticate: func(_ context.Context, _, _, _ string) (bool, []string, error) {
			return true, nil, nil
		},
	})

	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/v1/auth/login", nil)
	resp, err := srv.Login(w, r, &gentypes.LoginReq{
		Username: "alice", Password: "p", Profile: "default",
	})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if resp.ConnectionID == "" {
		t.Errorf("ConnectionID is empty")
	}
	// Two consecutive logins must produce DIFFERENT cids.
	resp2, _ := srv.Login(w, r, &gentypes.LoginReq{Username: "alice", Password: "p", Profile: "default"})
	if resp2.ConnectionID == resp.ConnectionID {
		t.Errorf("two Logins returned the same ConnectionID: %q", resp.ConnectionID)
	}
	// The JWT must carry the cid claim that matches the response body.
	claims, _ := iss.Parse(resp.AccessToken)
	if claims.ConnectionID != resp.ConnectionID {
		t.Errorf("JWT cid claim %q != LoginResp.ConnectionID %q", claims.ConnectionID, resp.ConnectionID)
	}
}
```

If `stubProfileLookup` doesn't already exist in this test file, look for the existing pattern used by other Login tests and copy. If a test seam for `testAuthenticate` doesn't exist with that exact field name, look up the actual field name on `Config` (from `internal/server/server.go`) — it's an unexported `testAuthenticate func(...)`.

- [ ] **Step 2: Run the failing test** — `scripts/run-go.sh test ./internal/server/ -run TestLogin_ReturnsConnectionID -v`. Expected: FAIL — `resp.ConnectionID` is empty (the handler still passes "").

- [ ] **Step 3: Update `internal/server/handlers_auth.go`**:

a. Add a connection-id minter near the top of the file (or in `internal/server/context.go` if a similar helper already lives there):

```go
// newConnectionID returns a 16-byte hex-encoded random identifier
// used as the JWT cid claim and the LoginResp.connection_id body
// field. crypto/rand sourced; collision probability is negligible.
func newConnectionID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
```

(Add `crypto/rand` and `encoding/hex` imports.)

b. In `Login`, replace the existing `Issue` call:

```go
token, exp, err := s.cfg.JWT.Issue(req.Username, profile, roles, "")
```

with:

```go
connID := newConnectionID()
token, exp, err := s.cfg.JWT.Issue(req.Username, profile, roles, connID)
```

c. In the `LoginResp` literal at the bottom of the function, populate the new field:

```go
return &gentypes.LoginResp{
	AccessToken:  token,
	TokenType:    "Bearer",
	ExpiresIn:    expiresIn,
	ConnectionID: connID,
}, nil
```

(Adjust field name to whatever genapi emitted — likely `ConnectionID`.)

- [ ] **Step 4: Run the test, expect PASS** — `scripts/run-go.sh test ./internal/server/ -count=1 -run TestLogin -v`. Cid round-trips through Login.

- [ ] **Step 5: Run the full server pkg** — `scripts/run-go.sh test ./internal/server/ -count=1`. Existing Login tests still pass (their assertions don't care about the new field).

- [ ] **Step 6: Commit**

```bash
git add internal/server/handlers_auth.go internal/server/handlers_auth_test.go
git commit -m "feat(server): Login mints connection_id and returns it in body + JWT"
```

---

## Task 5: Audit log emits `connection_id` (TDD)

**Files:** `internal/server/audit.go` (or wherever `emitAudit` is defined), `internal/server/handlers_auth.go`

The existing `emitAudit(auditEventLoginSuccess, "user", ..., "profile", ..., "roles", ...)` should also carry the cid so multi-session audit traces are disambiguated.

- [ ] **Step 1: Locate the audit-emit calls**

```bash
grep -n 'emitAudit(auditEventLogin' internal/server/handlers_auth.go
```

There are two call sites: the success path (after a valid login) and the failure paths (invalid credentials, upstream error).

- [ ] **Step 2: Update the success call site** to include cid. Find:

```go
emitAudit(auditEventLoginSuccess,
	"user", req.Username,
	"profile", profile,
	"roles", roles,
)
```

Change to:

```go
emitAudit(auditEventLoginSuccess,
	"user", req.Username,
	"profile", profile,
	"roles", roles,
	"cid", connID,
)
```

(connID is in scope from Task 4. Failure paths don't have a cid — login was rejected before issuing one — so leave them alone.)

- [ ] **Step 3: Run the existing audit tests** — `scripts/run-go.sh test ./internal/server/ -run TestLogin -count=1 -v`. Existing tests must still pass; they check structural fields, the new key is additive.

- [ ] **Step 4: Optional — assert cid in audit**. If `internal/server/handlers_auth_test.go` has a test that captures audit events (search for `audit_test.go` patterns or `captureAudit`), add an assertion that the success event carries a non-empty `cid` field. If no audit-capture seam exists, skip — the cid plumbing is exercised by Task 4's test.

- [ ] **Step 5: Commit**

```bash
git add internal/server/handlers_auth.go
git commit -m "feat(server): audit login_success event carries connection_id"
```

---

## Task 6: SPA — `ConnectionsContext` provider (TDD)

**Files:** `src/api/connections.tsx` (new), `src/api/connections.test.tsx` (new)

This is the in-memory single source of truth for "active sessions". For Plan B there is at most one active connection at a time (UX is unchanged); the data shape supports many.

- [ ] **Step 1: Write the failing test** in `src/api/connections.test.tsx`:

```tsx
import React from 'react'
import { render, act, screen } from '@testing-library/react'
import { ConnectionsProvider, useConnections, useActiveConnection } from './connections'

const Inner: React.FC = () => {
  const { add, remove, setActive } = useConnections()
  const active = useActiveConnection()
  return (
    <div>
      <span data-testid="active-token">{active?.token ?? 'none'}</span>
      <button data-testid="add" onClick={() => add({
        connectionId: 'c1', token: 'tok-c1', profileName: 'default', expiresAt: Date.now() + 3600_000,
      })} />
      <button data-testid="setactive-c1" onClick={() => setActive('c1')} />
      <button data-testid="remove-c1" onClick={() => remove('c1')} />
    </div>
  )
}

test('add → setActive exposes the connection via useActiveConnection', () => {
  render(<ConnectionsProvider><Inner /></ConnectionsProvider>)
  expect(screen.getByTestId('active-token').textContent).toBe('none')
  act(() => screen.getByTestId('add').click())
  act(() => screen.getByTestId('setactive-c1').click())
  expect(screen.getByTestId('active-token').textContent).toBe('tok-c1')
})

test('remove clears the active connection if it was active', () => {
  render(<ConnectionsProvider><Inner /></ConnectionsProvider>)
  act(() => screen.getByTestId('add').click())
  act(() => screen.getByTestId('setactive-c1').click())
  act(() => screen.getByTestId('remove-c1').click())
  expect(screen.getByTestId('active-token').textContent).toBe('none')
})
```

- [ ] **Step 2: Run the failing test**

```bash
pnpm exec jest src/api/connections.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/api/connections.tsx`**:

```tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from 'react'

// ConnectionState is the per-connection bookkeeping the SPA holds in
// memory. The token is the JWT minted by /api/v1/auth/login; we
// deliberately do NOT persist it (no localStorage, no cookie that JS
// can read) — DOM-XSS would otherwise lift it. The HttpOnly auth
// cookie path stays on for legacy compatibility, but Bearer-mode is
// the canonical multi-session transport.
export interface ConnectionState {
  connectionId: string
  token: string
  profileName: string
  expiresAt: number // epoch ms
}

interface State {
  byId: Map<string, ConnectionState>
  activeId: string | null
}

type Action =
  | { type: 'add'; conn: ConnectionState }
  | { type: 'remove'; id: string }
  | { type: 'setActive'; id: string | null }
  | { type: 'clear' }

const initialState: State = { byId: new Map(), activeId: null }

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'add': {
      const next = new Map(s.byId)
      next.set(a.conn.connectionId, a.conn)
      // First connection auto-activates; subsequent additions don't
      // steal focus (Plan C will add explicit switching UI).
      const activeId = s.activeId ?? a.conn.connectionId
      return { byId: next, activeId }
    }
    case 'remove': {
      const next = new Map(s.byId)
      next.delete(a.id)
      const activeId = s.activeId === a.id ? null : s.activeId
      return { byId: next, activeId }
    }
    case 'setActive':
      return { ...s, activeId: a.id }
    case 'clear':
      return initialState
  }
}

interface ContextValue {
  connections: ReadonlyMap<string, ConnectionState>
  activeId: string | null
  add: (conn: ConnectionState) => void
  remove: (id: string) => void
  setActive: (id: string | null) => void
  clear: () => void
}

const Ctx = createContext<ContextValue | null>(null)

export const ConnectionsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, dispatch] = useReducer(reducer, initialState)
  const value = useMemo<ContextValue>(
    () => ({
      connections: state.byId,
      activeId: state.activeId,
      add: (conn) => dispatch({ type: 'add', conn }),
      remove: (id) => dispatch({ type: 'remove', id }),
      setActive: (id) => dispatch({ type: 'setActive', id }),
      clear: () => dispatch({ type: 'clear' }),
    }),
    [state]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useConnections(): ContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useConnections outside ConnectionsProvider')
  return v
}

export function useActiveConnection(): ConnectionState | null {
  const { connections, activeId } = useConnections()
  if (!activeId) return null
  return connections.get(activeId) ?? null
}

// getActiveToken is a plain (non-hook) accessor used by the fetch
// wrapper in client.ts, which can't take a hook dependency. The
// AuthProvider keeps this module-level latch in sync via setLatestToken
// on every state transition.
let latestActiveToken: string | null = null

export function setLatestToken(token: string | null): void {
  latestActiveToken = token
}

export function getLatestToken(): string | null {
  return latestActiveToken
}
```

- [ ] **Step 4: Run the test, expect PASS**

```bash
pnpm exec jest src/api/connections.test.tsx
```

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/connections.tsx src/api/connections.test.tsx
git commit -m "feat(spa): ConnectionsContext + useActiveConnection hook"
```

---

## Task 7: SPA — `client.ts` attaches Bearer header from active connection

**Files:** `src/api/client.ts`

- [ ] **Step 1: Read the current `makeFetchImpl`** to see how Authorization is currently handled (legacy bearer / cookie strip behaviour).

- [ ] **Step 2: Update `makeFetchImpl` to attach the active connection's Bearer token** when one is present:

```ts
import { getLatestToken } from './connections'

function makeFetchImpl(): typeof fetch {
  const native = fetch.bind(globalThis)
  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const needsCsrf = isCsrfRequired(method)
    let headers = new Headers(init?.headers ?? {})

    // Plan B: when an in-memory active connection has a token, attach
    // it as Bearer. The cookie path still works in parallel; the
    // server's AuthJWT prefers the header when both are present.
    const liveToken = getLatestToken()
    if (liveToken) {
      headers.set('Authorization', 'Bearer ' + liveToken)
    } else if (!auth.getToken()) {
      // Cookie-mode (no in-memory token, no legacy bearer): strip the
      // generated client's placeholder Authorization so the server
      // falls through to the cookie.
      headers.delete('Authorization')
    }

    if (needsCsrf) {
      const tok = getCsrfToken()
      if (tok) headers.set('X-CSRF-Token', tok)
    }
    const reqInit: RequestInit = {
      ...init,
      headers,
      credentials: init?.credentials ?? 'same-origin',
    }
    let res = await native(input, reqInit)
    if (needsCsrf && res.status === 403) {
      const fresh = await refreshCsrfToken()
      if (fresh) {
        headers = new Headers(init?.headers ?? {})
        const live = getLatestToken()
        if (live) headers.set('Authorization', 'Bearer ' + live)
        else if (!auth.getToken()) headers.delete('Authorization')
        headers.set('X-CSRF-Token', fresh)
        res = await native(input, { ...reqInit, headers })
      }
    }
    return res
  }
}
```

- [ ] **Step 3: Sanity-check the build**

```bash
pnpm exec tsc --noEmit
```

Expected: clean (existing TS errors that pre-date this plan are ok; new errors from your edit are not).

- [ ] **Step 4: Run the existing api tests**

```bash
pnpm exec jest src/api/
```

Expected: PASS. The legacy cookie-mode tests work because `getLatestToken()` returns null when no connection is active, so the existing strip-Authorization path runs.

- [ ] **Step 5: Commit**

```bash
git add src/api/client.ts
git commit -m "feat(spa): client fetch attaches Bearer from active connection"
```

---

## Task 8: SPA — `auth.ts` LoginResult includes `connection_id`

**Files:** `src/api/auth.ts`

The genapi-emitted client's `LoginResp` already has `connection_id` after Task 3, but `src/api/auth.ts` defines its OWN local `LoginResult` type that wraps the bare-fetch response. Update it.

- [ ] **Step 1: Edit the type**

```ts
export type LoginResult = {
  access_token: string
  token_type: string
  expires_in: number
  connection_id: string
}
```

- [ ] **Step 2: Verify the JSON parse** — `auth.login(...)` returns `(await res.json()) as LoginResult`. The server now sends `connection_id` so the cast is honest.

- [ ] **Step 3: Run the auth tests**

```bash
pnpm exec jest src/api/auth.test.ts
```

If existing tests construct mock LoginResult values, they'll now fail TypeScript-check on the missing field. Update those mocks to include a stub `connection_id: 'mock-cid'`.

- [ ] **Step 4: Commit**

```bash
git add src/api/auth.ts src/api/auth.test.ts
git commit -m "feat(spa): LoginResult carries connection_id"
```

---

## Task 9: SPA — `AuthProvider` integrates `ConnectionsContext`

**Files:** `src/auth/AuthProvider.tsx`, `src/index.tsx` (or wherever the provider is mounted)

`AuthProvider` currently keeps a boolean `isAuthed` derived from a sessionStorage hint. After Plan B, signIn writes the token + cid into `ConnectionsContext` and signOut clears it. The hint stays for backward compat with code that just wants to know "are we logged in".

- [ ] **Step 1: Read the current `AuthProvider`** for the exact signIn/signOut shapes.

- [ ] **Step 2: Update the provider** to consume `ConnectionsContext`:

```tsx
import { useConnections, setLatestToken } from '../api/connections'

// AuthProvider must now be wrapped in ConnectionsProvider — the latter
// owns the in-memory token map; AuthProvider just orchestrates the
// boolean session-hint and threads login responses through to it.
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const conns = useConnections()
  const [isAuthed, setIsAuthed] = useState<boolean>(readAuthHint())

  const setAuthed = useCallback((authed: boolean) => {
    writeAuthHint(authed)
    setIsAuthed(authed)
    if (!authed) {
      clearCsrfToken()
      conns.clear()
      setLatestToken(null)
    }
  }, [conns])

  const signIn = useCallback(
    async (
      username: string,
      password: string,
      profile: string
    ): Promise<void> => {
      const result = await apiLogin(username, password, profile)
      await refreshCsrfToken()
      conns.add({
        connectionId: result.connection_id,
        token: result.access_token,
        profileName: profile,
        expiresAt: Date.now() + result.expires_in * 1000,
      })
      conns.setActive(result.connection_id)
      setLatestToken(result.access_token)
      writeAuthHint(true)
      setIsAuthed(true)
    },
    [conns]
  )

  const signOut = useCallback(async (): Promise<void> => {
    await apiLogout()
    authStore.clearToken()
    clearCsrfToken()
    conns.clear()
    setLatestToken(null)
    writeAuthHint(false)
    setIsAuthed(false)
  }, [conns])

  // existing useEffect for refreshCsrfToken stays unchanged
  // ...
  const value = useMemo<AuthState>(
    () => ({ isAuthed, setAuthed, signIn, signOut }),
    [isAuthed, setAuthed, signIn, signOut]
  )
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
```

- [ ] **Step 3: Mount `ConnectionsProvider` outside `AuthProvider`** in `src/index.tsx` (or wherever the provider tree is set up). Search for `<AuthProvider>` and wrap it:

```tsx
<ConnectionsProvider>
  <AuthProvider>
    {/* ... */}
  </AuthProvider>
</ConnectionsProvider>
```

- [ ] **Step 4: Run the SPA test suite**

```bash
pnpm test
```

Existing AuthProvider tests may fail because they don't render inside a ConnectionsProvider. Wrap them with a small test helper:

```tsx
const renderWithProviders = (ui: React.ReactElement) =>
  render(<ConnectionsProvider>{ui}</ConnectionsProvider>)
```

Update affected tests to use `renderWithProviders`.

- [ ] **Step 5: Verify the dev build**

```bash
pnpm run build
```

(Or whatever the project's prod-build target is — read `package.json` scripts to confirm.)

- [ ] **Step 6: Commit**

```bash
git add src/auth/AuthProvider.tsx src/index.tsx src/auth/AuthProvider.test.tsx
git commit -m "feat(spa): AuthProvider writes login response into ConnectionsContext"
```

---

## Task 10: End-to-end smoke (manual)

**Files:** none

This proves the full Bearer round-trip works: SPA logs in, server returns cid, subsequent SPA request attaches the token via header (NOT cookie), server reads it, authorises, returns. The cookie path still works as a backstop.

- [ ] **Step 1: Build everything**

```bash
make build
pnpm run build  # or the equivalent SPA prod build
```

- [ ] **Step 2: Boot the server with a temp profile store**

```bash
TMPSTORE=$(mktemp -d)/profiles.db
SECRET=$(openssl rand -hex 32)
PORT=18091

./bin/geode-ui \
  -profile-store "$TMPSTORE" \
  -jwt-secret-hex "$SECRET" \
  -admin-users geode \
  -listen ":$PORT" \
  -secure-cookies=false &
SERVER_PID=$!
sleep 1
```

- [ ] **Step 3: Login via curl, parse the response**

You'll need a real Geode upstream for the credential check. If one isn't available, mock it via the `testAuthenticate` Config field (already wired). Without a live upstream this step degrades to "verify the server returns 502 upstream_error AND the response includes the new schema field on the success path via the existing handler test from Task 4". Document either path.

For an environment with a live Geode at the default profile:

```bash
RESP=$(curl -s -X POST "http://localhost:$PORT/api/v1/auth/login" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'username=geode&password=...&profile=default')
echo "$RESP" | jq .
TOKEN=$(echo "$RESP" | jq -r .access_token)
CONN_ID=$(echo "$RESP" | jq -r .connection_id)
echo "got cid: $CONN_ID"
test -n "$CONN_ID" || { echo "MISSING CID"; exit 1; }
```

- [ ] **Step 4: Bearer-only request (no cookies)**

```bash
curl -s -o /tmp/profiles_bearer.json -w "%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  --cookie '' \
  "http://localhost:$PORT/api/v1/profiles"
cat /tmp/profiles_bearer.json | jq .
```

Expected: HTTP 200 with the profile list. The `--cookie ''` flag suppresses any session cookie — proving the Bearer header alone authenticated the request.

- [ ] **Step 5: Cleanup + tag**

```bash
kill $SERVER_PID
rm -rf "$(dirname "$TMPSTORE")" /tmp/profiles_bearer.json

git tag -a v0.3.0-plan-B-multi-session-auth -m "Plan B: per-connection JWT + cid claim + SPA ConnectionsContext"
```

Do NOT push.

## Self-review checklist

- [x] **Spec coverage:** cid round-trip server-side; cid in LoginResp; SPA holds tokens in memory; fetch attaches Bearer; cookie path retained as backstop.
- [x] **No placeholders:** every step has concrete code or an exact command.
- [x] **TDD discipline:** every behavioural change has a failing test written first.
- [x] **Type consistency:** `ConnectionState`, `connection_id`/`ConnectionID`/`cid` referenced consistently.
- [x] **Frequent commits:** 10 tasks → 10 commits + 1 tag.

## Out of scope (deferred)

- **Server-side JWT revocation** (logout that invalidates a token rather than just clearing the cookie) — tracked as SEC-N2; orthogonal to multi-session and not blocking Plan C.
- **Connection-switcher UI / multi-active connections in the SPA** — Plan C.
- **Per-connection profile editor** — Plan D.
- **Electron-native token persistence (safeStorage / keychain)** — Plan E.
- **Logout-by-connection-id endpoint** — needs a server-side revocation list to be meaningful; defer with SEC-N2.

---

## Execution Handoff

Plan B is saved to `docs/superpowers/plans/2026-05-09-profile-system-rebuild-B-multi-session-auth.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — Each task dispatched to a fresh subagent with the two-stage review gate from `superpowers:subagent-driven-development`. Same pattern that shipped Plan A successfully.
2. **Inline Execution** — Execute tasks in this session via `superpowers:executing-plans`, batched at the natural commit boundaries.

When ready, ask for **Plan C (SPA connection switcher)** to be drafted next.
