# Login Profile UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the LoginPage handle large profile lists gracefully (filterable picker), let operators create new profiles directly from the login screen (creds-validated onboarding), and auto-route first-run sessions (zero profiles) straight to the onboarding form.

**Architecture:** Three coordinated pieces. (1) A new `ProfileFilter` SPA component that replaces the existing N-button profile list with a text-filtered scrollable list — preserves the existing radio-style click-to-select but scales to dozens of profiles without dominating the form card. (2) A new `OnboardProfileForm` SPA component plus a hand-rolled unauthenticated server endpoint `POST /api/v1/profiles/onboard` that creates a system-scope profile only after validating the supplied admin credentials against the upstream DSN — gives the SPA a way to add a profile without an existing JWT. (3) LoginPage gains a three-way render branch: zero profiles → mount OnboardProfileForm as the landing view; one-or-more profiles → mount the new ProfileFilter; a persistent "Add profile" affordance toggles to OnboardProfileForm in either case. The server endpoint reuses the existing `authenticateUpstream` probe and profilestore.Put pipeline so no new auth/storage primitives are introduced.

**Tech Stack:** TypeScript / React 18.2 / Web Awesome / Bootstrap 5.3 (SPA), Go 1.26.3 / stdlib net/http / modernc.org/sqlite (server), Jest + Testing Library (SPA tests), table-driven Go tests, Playwright (e2e).

---

## File Structure

**New files (SPA):**
- `src/components/auth/ProfileFilter.tsx` — filterable picker; ~120 LoC
- `src/components/auth/ProfileFilter.test.tsx` — unit + interaction tests
- `src/components/auth/OnboardProfileForm.tsx` — name/DSN/description + admin creds form; ~150 LoC
- `src/components/auth/OnboardProfileForm.test.tsx` — unit + interaction tests

**New files (server):**
- `internal/server/handlers_profiles_onboard.go` — `HandleOnboard` handler + request/response types
- `internal/server/handlers_profiles_onboard_test.go` — table-driven tests

**New files (tests / docs):**
- `e2e/specs/39-profile-onboarding.spec.ts` — end-to-end onboard flow against the live two-Geode stack

**Modified files:**
- `src/api/auth.ts` — add `onboardProfile()` API helper + `OnboardRequest`/`OnboardResponse` types
- `src/pages/LoginPage.tsx` — three-way render branch (Onboard / Filter / fallback) + Add-Profile toggle
- `src/pages/LoginPage.test.tsx` — cover the three branches + toggle
- `src/services/i18n/locales/en.ts` — new `auth.profileFilter*` + `auth.onboard*` keys
- `cmd/server/app_routes.go` — wire the new route alongside `HandleWhoAmI`

**Responsibility split:** `ProfileFilter` is purely presentational (no fetches, no API calls) — it takes a `PublicProfile[]` plus selection state from the parent. `OnboardProfileForm` owns its own submit flow but receives an `onSuccess` callback so the parent (LoginPage) controls what happens after a profile is created. The server endpoint is single-purpose: validate creds + create profile + mint JWT. Anything fancier (telemetry, multi-step wizard) is deliberately out of scope.

---

## Task 1: Server — `HandleOnboard` request/response types and core validation

**Files:**
- Create: `internal/server/handlers_profiles_onboard.go`
- Create: `internal/server/handlers_profiles_onboard_test.go`

The first slice is the no-DB-touch path: input parsing, validation, and the 4xx response shapes. We add the upstream-creds-validation + profilestore.Put + JWT-mint in subsequent tasks so each step stays reviewable.

- [ ] **Step 1: Write the failing test for input validation**

Create `internal/server/handlers_profiles_onboard_test.go`:

```go
package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOnboard_MethodNotAllowed(t *testing.T) {
	srv := New(Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/profiles/onboard", nil)
	srv.HandleOnboard(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d want 405", rec.Code)
	}
	if rec.Header().Get("Allow") != http.MethodPost {
		t.Errorf("Allow=%q want POST", rec.Header().Get("Allow"))
	}
}

func TestOnboard_RejectsMissingFields(t *testing.T) {
	srv := New(Config{})
	cases := []struct {
		name string
		body string
	}{
		{"empty body", `{}`},
		{"missing name", `{"dsn":"quic://x:3141","admin_username":"u","admin_password":"p"}`},
		{"missing dsn", `{"name":"prod","admin_username":"u","admin_password":"p"}`},
		{"missing admin_username", `{"name":"prod","dsn":"quic://x:3141","admin_password":"p"}`},
		{"missing admin_password", `{"name":"prod","dsn":"quic://x:3141","admin_username":"u"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(
				http.MethodPost,
				"/api/v1/profiles/onboard",
				bytes.NewReader([]byte(tc.body)),
			)
			req.Header.Set("Content-Type", "application/json")
			srv.HandleOnboard(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), ErrCodeInvalidRequest) {
				t.Errorf("body=%s want %q", rec.Body.String(), ErrCodeInvalidRequest)
			}
		})
	}
}

func TestOnboard_RejectsInvalidDSNScheme(t *testing.T) {
	srv := New(Config{})
	rec := httptest.NewRecorder()
	body, _ := json.Marshal(map[string]string{
		"name":           "prod",
		"dsn":            "http://example.com:8080",
		"admin_username": "alice",
		"admin_password": "pw",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles/onboard", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.HandleOnboard(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "dsn") {
		t.Errorf("expected dsn-error message; got %s", rec.Body.String())
	}
}
```

- [ ] **Step 2: Run the test, confirm it fails**

```sh
GOEXPERIMENT=jsonv2 go test ./internal/server/ -run TestOnboard -count=1
```

Expected: build failure (`HandleOnboard` undefined) OR test failure for missing handler.

- [ ] **Step 3: Add the handler skeleton with input validation**

Create `internal/server/handlers_profiles_onboard.go`:

```go
package server

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
)

// OnboardRequest is the JSON body for POST /api/v1/profiles/onboard.
//
// Bug-feature (2026-05-21 login profile UX): unauthenticated profile
// creation. The endpoint accepts admin credentials for the supplied
// DSN and creates the profile ONLY after a successful auth probe.
// Used by the SPA's first-run + add-from-login flows; no existing
// JWT is required to call it.
type OnboardRequest struct {
	Name          string `json:"name"`
	DSN           string `json:"dsn"`
	Description   string `json:"description,omitempty"`
	AdminUsername string `json:"admin_username"`
	AdminPassword string `json:"admin_password"`
}

// OnboardResponse is the JSON body returned on a successful onboard.
// access_token / expires_in mirror /api/v1/auth/login so the SPA can
// roll straight into an authenticated session without a second
// round-trip.
type OnboardResponse struct {
	ProfileID    string `json:"profile_id"`
	ProfileName  string `json:"profile_name"`
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	ConnectionID string `json:"connection_id"`
}

// HandleOnboard implements POST /api/v1/profiles/onboard.
//
// Phase 1 (this task): input validation only. The upstream-credentials
// probe and the profilestore.Put + JWT-mint pipeline ship in
// subsequent tasks so each diff stays reviewable.
func (s *GraphServer) HandleOnboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req OnboardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadRequest,
			code:        ErrCodeInvalidRequest,
			description: "request body must be valid JSON",
		})
		return
	}
	if err := validateOnboardRequest(&req); err != nil {
		writeEndpointError(w, err)
		return
	}
	// TODO(next task): probe upstream creds, create profile, mint JWT.
	writeEndpointError(w, &endpointError{
		status:      http.StatusNotImplemented,
		code:        "not_implemented",
		description: "upstream probe + storage path lands in task 2",
	})
}

func validateOnboardRequest(req *OnboardRequest) *endpointError {
	req.Name = strings.TrimSpace(req.Name)
	req.DSN = strings.TrimSpace(req.DSN)
	req.AdminUsername = strings.TrimSpace(req.AdminUsername)
	if req.Name == "" || req.DSN == "" || req.AdminUsername == "" || req.AdminPassword == "" {
		return &endpointError{
			status:      http.StatusBadRequest,
			code:        ErrCodeInvalidRequest,
			description: "name, dsn, admin_username, and admin_password are required",
		}
	}
	u, err := url.Parse(req.DSN)
	if err != nil || u.Scheme != "quic" || u.Host == "" {
		return &endpointError{
			status:      http.StatusBadRequest,
			code:        ErrCodeInvalidRequest,
			description: "dsn must be a quic:// URL with an explicit host:port",
		}
	}
	return nil
}
```

- [ ] **Step 4: Confirm `ErrCodeInvalidRequest` already exists; if not, add it**

```sh
grep -n 'ErrCodeInvalidRequest' internal/server/errorcodes.go
```

If absent, add to `internal/server/errorcodes.go`:

```go
// ErrCodeInvalidRequest: malformed request body or invalid arguments
// to an unauthenticated endpoint. Used by HandleOnboard and any future
// pre-auth handlers; distinct from ErrCodeInvalidPassword (password-
// policy violations) and ErrCodeForbidden (authorisation failures).
ErrCodeInvalidRequest = "invalid_request"
```

Append `ErrCodeInvalidRequest` to the registered slice at the bottom of the file (search for the existing slice that includes `ErrCodeForbidden`).

- [ ] **Step 5: Run tests; confirm they pass**

```sh
GOEXPERIMENT=jsonv2 go test ./internal/server/ -run TestOnboard -count=1 -v
```

Expected: 3 tests pass.

- [ ] **Step 6: Run gofmt + go vet**

```sh
gofmt -s -w internal/server/handlers_profiles_onboard.go internal/server/handlers_profiles_onboard_test.go
GOEXPERIMENT=jsonv2 go vet ./internal/server/
```

Expected: no output.

- [ ] **Step 7: Commit**

```sh
git add internal/server/handlers_profiles_onboard.go internal/server/handlers_profiles_onboard_test.go internal/server/errorcodes.go
git commit -m "feat(server): HandleOnboard skeleton + input validation"
```

---

## Task 2: Server — Upstream creds probe + profile creation + JWT mint

**Files:**
- Modify: `internal/server/handlers_profiles_onboard.go`
- Modify: `internal/server/handlers_profiles_onboard_test.go`

We now wire the rest of the pipeline: probe the supplied creds against the DSN via the existing `authenticateUpstream` helper, persist the profile via the configured Store, mint a JWT.

- [ ] **Step 1: Examine `authenticateUpstream` to understand its signature**

```sh
grep -n 'func .*authenticateUpstream' internal/server/handlers_auth.go
```

Identify the (ctx, pool/dsn, username, password) inputs and the returned `(roles, error)` shape.

- [ ] **Step 2: Write the happy-path test (with stubbed Pool + Store + Issuer)**

Append to `internal/server/handlers_profiles_onboard_test.go`:

```go
func TestOnboard_HappyPath(t *testing.T) {
	iss := newTestIssuer(t)
	store := newFakeProfileStore() // see helper at the bottom
	pool := newFakeProbingPool(t, "alice", "pw") // accepts only (alice,pw)
	srv := New(Config{JWT: iss, Store: store, Pool: pool})

	body, _ := json.Marshal(map[string]string{
		"name":           "prod",
		"dsn":            "quic://prod.example.com:3141",
		"description":    "production geode",
		"admin_username": "alice",
		"admin_password": "pw",
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles/onboard", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.HandleOnboard(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s want 200", rec.Code, rec.Body.String())
	}
	var resp OnboardResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.ProfileID == "" {
		t.Error("profile_id empty")
	}
	if resp.ProfileName != "prod" {
		t.Errorf("ProfileName=%q want prod", resp.ProfileName)
	}
	if resp.AccessToken == "" {
		t.Error("access_token empty")
	}
	if _, err := iss.Parse(resp.AccessToken); err != nil {
		t.Errorf("returned token does not parse: %v", err)
	}
	if len(store.puts) != 1 {
		t.Fatalf("Store.Put called %d times, want 1", len(store.puts))
	}
	if store.puts[0].Name != "prod" {
		t.Errorf("stored profile name=%q want prod", store.puts[0].Name)
	}
}

func TestOnboard_RejectsBadUpstreamCredentials(t *testing.T) {
	iss := newTestIssuer(t)
	store := newFakeProfileStore()
	pool := newFakeProbingPool(t, "alice", "correct-pw")
	srv := New(Config{JWT: iss, Store: store, Pool: pool})

	body, _ := json.Marshal(map[string]string{
		"name":           "prod",
		"dsn":            "quic://prod.example.com:3141",
		"admin_username": "alice",
		"admin_password": "wrong-pw",
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles/onboard", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.HandleOnboard(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401 body=%s", rec.Code, rec.Body.String())
	}
	if len(store.puts) != 0 {
		t.Errorf("Store.Put fired despite auth failure (count=%d)", len(store.puts))
	}
}

func TestOnboard_RejectsDuplicateName(t *testing.T) {
	iss := newTestIssuer(t)
	store := newFakeProfileStore()
	// Pre-existing profile with the same name.
	store.existing = []conn.Profile{{Name: "prod", Scope: conn.ProfileScopeSystem}}
	pool := newFakeProbingPool(t, "alice", "pw")
	srv := New(Config{JWT: iss, Store: store, Pool: pool})

	body, _ := json.Marshal(map[string]string{
		"name":           "prod",
		"dsn":            "quic://prod.example.com:3141",
		"admin_username": "alice",
		"admin_password": "pw",
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles/onboard", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.HandleOnboard(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d want 409", rec.Code)
	}
}
```

Add helpers at the bottom of the same file (after the existing `init`/tests):

```go
type fakeProfileStore struct {
	puts     []conn.Profile
	existing []conn.Profile
}

func newFakeProfileStore() *fakeProfileStore { return &fakeProfileStore{} }

func (f *fakeProfileStore) Put(_ context.Context, p conn.Profile) (conn.Profile, error) {
	for _, e := range f.existing {
		if strings.EqualFold(e.Name, p.Name) {
			return conn.Profile{}, profilestore.ErrConflict
		}
	}
	if p.ID == "" {
		p.ID = "onb-" + p.Name
	}
	f.puts = append(f.puts, p)
	return p, nil
}

func (f *fakeProfileStore) List(_ context.Context, _ profilestore.Filter) ([]conn.Profile, error) {
	return append([]conn.Profile{}, f.existing...), nil
}

func (f *fakeProfileStore) Get(_ context.Context, id string) (conn.Profile, error) {
	for _, e := range f.existing {
		if e.ID == id {
			return e, nil
		}
	}
	return conn.Profile{}, profilestore.ErrNotFound
}

func (f *fakeProfileStore) Patch(_ context.Context, _ string, _ profilestore.ProfilePatch) (conn.Profile, error) {
	return conn.Profile{}, profilestore.ErrNotFound
}

func (f *fakeProfileStore) Delete(_ context.Context, _ string) error { return nil }
func (f *fakeProfileStore) Close() error                              { return nil }
```

For `fakeProbingPool`: study the existing `stubPool` in `handlers_users_test.go` for the contract and copy its shape. The minimal probe path calls `Pool.DB(profileName) → *sql.DB → RETURN 1`. For onboarding we are NOT using the configured profile name; the handler opens a one-shot connection against the supplied DSN with the supplied creds, so the fake needs to capture (dsn, username, password) and decide whether to accept.

- [ ] **Step 3: Add `context`, `conn`, `profilestore` imports to the test file**

Append:

```go
import (
	"context"
	// ...existing imports
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"
)
```

- [ ] **Step 4: Run tests; confirm they fail**

```sh
GOEXPERIMENT=jsonv2 go test ./internal/server/ -run TestOnboard -count=1
```

Expected: FAIL — the handler still returns 501.

- [ ] **Step 5: Implement the upstream probe + Put + Issue pipeline**

Replace the TODO branch in `HandleOnboard`:

```go
// Probe the DSN with the supplied creds via a one-shot *sql.DB.
// The existing authenticateUpstream helper does the cookie-cutter
// dial-and-RETURN-1 dance; pass the DSN we just validated.
roles, err := s.authenticateOnboard(r.Context(), req.DSN, req.AdminUsername, req.AdminPassword)
if err != nil {
	writeEndpointError(w, &endpointError{
		status:      http.StatusUnauthorized,
		code:        ErrCodeUnauthorized,
		description: "upstream rejected the supplied admin credentials",
	})
	return
}

if s.cfg.Store == nil {
	writeStoreUnavailable(w)
	return
}

p, err := s.cfg.Store.Put(r.Context(), conn.Profile{
	Scope:       conn.ProfileScopeSystem,
	Name:        req.Name,
	DSN:         req.DSN,
	Description: req.Description,
})
if err != nil {
	if errors.Is(err, profilestore.ErrConflict) {
		writeEndpointError(w, &endpointError{
			status:      http.StatusConflict,
			code:        ErrCodeConflict,
			description: "a profile with that name already exists",
		})
		return
	}
	writeEndpointError(w, storeErrorToHTTP(err))
	return
}

if s.cfg.JWT == nil {
	// Successful create but no Issuer configured — return the
	// profile_id so a subsequent /api/v1/auth/login can take over.
	writeJSON(w, http.StatusOK, OnboardResponse{
		ProfileID:   p.ID,
		ProfileName: p.Name,
		TokenType:   "bearer",
	})
	return
}

token, exp, err := s.cfg.JWT.Issue(req.AdminUsername, req.Name, roles, "")
if err != nil {
	writeEndpointError(w, &endpointError{
		status:      http.StatusInternalServerError,
		code:        "internal_error",
		description: "could not mint access token",
	})
	return
}
expiresIn := s.mintAndSetAuthCookie(w, token, exp)
writeJSON(w, http.StatusOK, OnboardResponse{
	ProfileID:   p.ID,
	ProfileName: p.Name,
	AccessToken: token,
	TokenType:   "bearer",
	ExpiresIn:   expiresIn,
})
```

Add the `authenticateOnboard` helper to the same file:

```go
// authenticateOnboard mirrors authenticateUpstream but is keyed on
// an explicit DSN rather than a stored profile name. The onboarding
// path does not have a profile registered yet, so it cannot route
// through the connection Pool the way the login handler does.
func (s *GraphServer) authenticateOnboard(
	ctx context.Context, dsn, username, password string,
) ([]string, error) {
	// Reuse the same probe semantics as authenticateUpstream: open
	// a short-lived *sql.DB with the creds inlined into the DSN, run
	// RETURN 1, classify the response. The helper returns nil roles
	// for v0.5.x (matches authenticateUpstream's behaviour) — the
	// SPA will surface admin posture via the same sessionStorage
	// roles echo as the regular login path.
	probeDSN, err := injectCreds(dsn, username, password)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("geode", probeDSN)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	row := db.QueryRowContext(ctx, "RETURN 1")
	var v any
	if err := row.Scan(&v); err != nil {
		return nil, err
	}
	return nil, nil
}
```

Add the missing imports at the top of the file:

```go
import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"
)
```

If `writeJSON` doesn't exist, add a small helper at the bottom:

```go
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
```

(check first with `grep -n 'func writeJSON' internal/server/*.go` and reuse the existing helper if present.)

- [ ] **Step 6: Run tests; confirm they pass**

```sh
GOEXPERIMENT=jsonv2 go test ./internal/server/ -run TestOnboard -count=1 -v
```

Expected: all 6 tests pass.

- [ ] **Step 7: Run the broader server test suite to confirm no regressions**

```sh
GOEXPERIMENT=jsonv2 go test ./internal/server/ -count=1
```

Expected: green.

- [ ] **Step 8: gofmt + commit**

```sh
gofmt -s -w internal/server/handlers_profiles_onboard.go internal/server/handlers_profiles_onboard_test.go
git add internal/server/handlers_profiles_onboard.go internal/server/handlers_profiles_onboard_test.go
git commit -m "feat(server): onboard endpoint validates creds + creates profile + mints JWT"
```

---

## Task 3: Server — Wire the route

**Files:**
- Modify: `cmd/server/app_routes.go`

- [ ] **Step 1: Read the existing route table location**

```sh
grep -n 'mux.HandleFunc.*auth/whoami' cmd/server/app_routes.go
```

- [ ] **Step 2: Add the new route alongside whoami**

Edit `cmd/server/app_routes.go`, inserting after the existing `mux.HandleFunc("GET /api/v1/auth/whoami", srv.HandleWhoAmI)` block:

```go
// 2026-05-21 login profile UX: unauthenticated profile onboarding.
// POST /api/v1/profiles/onboard takes a name + DSN + admin
// credentials, probes the upstream, creates a system-scope profile,
// and mints a JWT in one shot. Used by the SPA's first-run path
// (zero profiles → landing screen is the onboard form) and the
// add-profile-from-login flow. Hand-rolled rather than genapi-
// emitted because the route is intentionally unauthenticated.
mux.HandleFunc("POST /api/v1/profiles/onboard", srv.HandleOnboard)
```

- [ ] **Step 3: Run the existing app-level tests**

```sh
GOEXPERIMENT=jsonv2 go test ./cmd/server/ ./internal/server/ -count=1
```

Expected: green.

- [ ] **Step 4: Commit**

```sh
git add cmd/server/app_routes.go
git commit -m "feat(server): wire POST /api/v1/profiles/onboard"
```

---

## Task 4: Client — `onboardProfile()` API helper

**Files:**
- Modify: `src/api/auth.ts`
- Create: `src/api/auth.onboard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/api/auth.onboard.test.ts`:

```ts
/// <reference types="@testing-library/jest-dom" />
import { onboardProfile } from './auth'

const realFetch = global.fetch

beforeEach(() => {
  ;(global as unknown as { fetch: jest.Mock }).fetch = jest.fn()
})

afterEach(() => {
  ;(global as unknown as { fetch: typeof realFetch }).fetch = realFetch
})

test('onboardProfile posts JSON to /api/v1/profiles/onboard and returns the parsed body', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      profile_id: 'onb-prod',
      profile_name: 'prod',
      access_token: 'jwt-abc',
      token_type: 'bearer',
      expires_in: 3600,
      connection_id: '',
    }),
  })

  const result = await onboardProfile({
    name: 'prod',
    dsn: 'quic://prod.example.com:3141',
    description: 'production',
    admin_username: 'alice',
    admin_password: 'pw',
  })

  expect(global.fetch).toHaveBeenCalledWith(
    '/api/v1/profiles/onboard',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
      }),
    })
  )
  const call = (global.fetch as jest.Mock).mock.calls[0]
  const body = JSON.parse(call[1].body)
  expect(body).toEqual({
    name: 'prod',
    dsn: 'quic://prod.example.com:3141',
    description: 'production',
    admin_username: 'alice',
    admin_password: 'pw',
  })
  expect(result.access_token).toBe('jwt-abc')
  expect(result.profile_id).toBe('onb-prod')
})

test('onboardProfile throws on non-2xx with the server-supplied error message', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status: 401,
    json: async () => ({
      error: 'unauthorized',
      error_description: 'upstream rejected the supplied admin credentials',
    }),
  })

  await expect(
    onboardProfile({
      name: 'prod',
      dsn: 'quic://x:3141',
      admin_username: 'alice',
      admin_password: 'wrong',
    })
  ).rejects.toThrow(/upstream rejected/)
})
```

- [ ] **Step 2: Run, confirm it fails**

```sh
npx jest src/api/auth.onboard.test.ts --no-coverage
```

Expected: FAIL — `onboardProfile` is not exported.

- [ ] **Step 3: Implement `onboardProfile` in `src/api/auth.ts`**

Append after the existing `fetchWhoAmI()` function:

```ts
export interface OnboardRequest {
  name: string
  dsn: string
  description?: string
  admin_username: string
  admin_password: string
}

export interface OnboardResponse {
  profile_id: string
  profile_name: string
  access_token: string
  token_type: string
  expires_in: number
  connection_id?: string
}

/**
 * onboardProfile creates a new system-scope profile against the
 * unauthenticated POST /api/v1/profiles/onboard endpoint. The server
 * validates the supplied admin credentials against the supplied DSN
 * before persisting; on success it returns a JWT so the SPA can roll
 * straight into an authenticated session.
 *
 * Direct fetch (NOT through the generated `client`) — the endpoint is
 * unauthenticated, so dragging the bearer-token guard along is wrong.
 */
export async function onboardProfile(
  req: OnboardRequest
): Promise<OnboardResponse> {
  const res = await fetch('/api/v1/profiles/onboard', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string
      error_description?: string
    }
    const detail = err.error_description || err.error
    throw new Error(detail || `onboardProfile failed (${res.status})`)
  }
  return (await res.json()) as OnboardResponse
}
```

- [ ] **Step 4: Re-run, confirm green**

```sh
npx jest src/api/auth.onboard.test.ts --no-coverage
```

Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```sh
git add src/api/auth.ts src/api/auth.onboard.test.ts
git commit -m "feat(api): onboardProfile() helper for unauthenticated profile creation"
```

---

## Task 5: SPA — `ProfileFilter` component

**Files:**
- Create: `src/components/auth/ProfileFilter.tsx`
- Create: `src/components/auth/ProfileFilter.test.tsx`

A purely presentational filterable picker. Takes the public-profiles list plus selection state and emits selection-changed events. No data fetches.

- [ ] **Step 1: Write the failing tests**

Create `src/components/auth/ProfileFilter.test.tsx`:

```tsx
/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../services/i18n/config'
import { lightTheme } from '@geodedb/ui-core/theme'
import { ProfileFilter } from './ProfileFilter'

function wrap(ui: React.ReactElement): React.ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>{ui}</ThemeProvider>
    </I18nextProvider>
  )
}

const profiles = [
  { name: 'default', description: 'in-cluster geode' },
  { name: 'social', description: 'social graph fixture' },
  { name: 'staging', description: 'staging cluster' },
  { name: 'prod', description: 'production cluster' },
]

test('renders one row per profile', () => {
  render(wrap(<ProfileFilter profiles={profiles} value="default" onChange={() => {}} />))
  profiles.forEach((p) => {
    expect(screen.getByTestId(`profile-filter-row-${p.name}`)).toBeInTheDocument()
  })
})

test('filter input narrows the rendered rows (case-insensitive substring)', () => {
  render(wrap(<ProfileFilter profiles={profiles} value="default" onChange={() => {}} />))
  const filter = screen.getByTestId('profile-filter-input') as HTMLInputElement
  fireEvent.change(filter, { target: { value: 'STAGE' } })
  expect(screen.getByTestId('profile-filter-row-staging')).toBeInTheDocument()
  expect(screen.queryByTestId('profile-filter-row-default')).toBeNull()
  expect(screen.queryByTestId('profile-filter-row-social')).toBeNull()
})

test('filter matches against the description field too', () => {
  render(wrap(<ProfileFilter profiles={profiles} value="default" onChange={() => {}} />))
  fireEvent.change(screen.getByTestId('profile-filter-input'), {
    target: { value: 'fixture' },
  })
  expect(screen.getByTestId('profile-filter-row-social')).toBeInTheDocument()
  expect(screen.queryByTestId('profile-filter-row-prod')).toBeNull()
})

test('clicking a row calls onChange with the row name', () => {
  const onChange = jest.fn()
  render(wrap(<ProfileFilter profiles={profiles} value="default" onChange={onChange} />))
  fireEvent.click(screen.getByTestId('profile-filter-row-social'))
  expect(onChange).toHaveBeenCalledWith('social')
})

test('the currently-selected row carries aria-selected="true"', () => {
  render(wrap(<ProfileFilter profiles={profiles} value="social" onChange={() => {}} />))
  expect(screen.getByTestId('profile-filter-row-social')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(screen.getByTestId('profile-filter-row-default')).toHaveAttribute(
    'aria-selected',
    'false'
  )
})

test('shows an empty-state message when filter narrows to zero rows', () => {
  render(wrap(<ProfileFilter profiles={profiles} value="default" onChange={() => {}} />))
  fireEvent.change(screen.getByTestId('profile-filter-input'), {
    target: { value: 'zzz' },
  })
  expect(screen.getByTestId('profile-filter-empty')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run, confirm failure**

```sh
npx jest src/components/auth/ProfileFilter.test.tsx --no-coverage
```

Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `ProfileFilter.tsx`**

Create `src/components/auth/ProfileFilter.tsx`:

```tsx
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { PublicProfile } from '../../api/auth'

// ProfileFilter — filterable scrollable list of public profiles for
// the LoginPage. Replaces the prior list-of-N-wa-buttons rendering so
// a large profile catalogue (dozens of entries) stays usable inside
// the 380px form card.
//
// Purely presentational: takes the profile list + current selection
// from the parent (LoginPage) and emits selection changes via
// onChange. Has no network calls and does not own the public-profiles
// fetch — that stays with usePublicProfilesWithStoredPasswords on the
// LoginPage so AddConnectionModal can share the same hook.
//
// A11y: rendered as a single ARIA listbox with each row aria-
// selected. Keyboard navigation defers to native scrolling +
// focus-on-click; arrow-key navigation can be added later if real
// usage shows the click-to-select pattern is insufficient.

export interface ProfileFilterProps {
  profiles: ReadonlyArray<PublicProfile>
  value: string
  onChange: (name: string) => void
}

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 14rem;
  overflow-y: auto;
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  background: ${({ theme }) => theme.bg.surface};
`

const Row = styled.li<{ $selected: boolean }>`
  padding: ${({ theme }) => theme.spacing.sm};
  cursor: pointer;
  background: ${({ $selected, theme }) =>
    $selected ? theme.bg.subtle : 'transparent'};
  border-bottom: 1px solid ${({ theme }) => theme.border.subtle};
  &:last-child {
    border-bottom: none;
  }
  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
  }
`

const RowName = styled.div`
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  color: ${({ theme }) => theme.text.primary};
`

const RowDescription = styled.div`
  font-size: ${({ theme }) => theme.font.sizes.sm};
  color: ${({ theme }) => theme.text.secondary};
  overflow-wrap: anywhere;
`

const Empty = styled.p`
  margin: 0;
  padding: ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.text.secondary};
  text-align: center;
`

export const ProfileFilter: React.FC<ProfileFilterProps> = ({
  profiles,
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return profiles
    return profiles.filter((p) => {
      if (p.name.toLowerCase().includes(needle)) return true
      if (p.description && p.description.toLowerCase().includes(needle)) {
        return true
      }
      return false
    })
  }, [profiles, filter])

  return (
    <div className="d-flex flex-column gap-2">
      <input
        type="text"
        className="form-control form-control-sm"
        placeholder={t('auth.profileFilterPlaceholder')}
        aria-label={t('auth.profileFilterAria')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        data-testid="profile-filter-input"
      />
      {visible.length === 0 ? (
        <Empty role="status" data-testid="profile-filter-empty">
          {t('auth.profileFilterEmpty')}
        </Empty>
      ) : (
        <List role="listbox" aria-label={t('auth.profileList')}>
          {visible.map((p) => (
            <Row
              key={p.name}
              role="option"
              aria-selected={p.name === value}
              $selected={p.name === value}
              onClick={() => onChange(p.name)}
              data-testid={`profile-filter-row-${p.name}`}
            >
              <RowName>{p.name}</RowName>
              {p.description ? (
                <RowDescription>{p.description}</RowDescription>
              ) : null}
            </Row>
          ))}
        </List>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Add the i18n keys for the new component**

Append to `src/services/i18n/locales/en.ts` inside the existing `auth: { ... }` block (find the closing brace and add before it):

```ts
    profileFilterPlaceholder: 'Filter profiles…',
    profileFilterAria: 'Filter profiles',
    profileFilterEmpty: 'No profiles match the filter.',
```

- [ ] **Step 5: Re-run tests; confirm green**

```sh
npx jest src/components/auth/ProfileFilter.test.tsx --no-coverage
```

Expected: 6 passing tests.

- [ ] **Step 6: Commit**

```sh
git add src/components/auth/ProfileFilter.tsx src/components/auth/ProfileFilter.test.tsx src/services/i18n/locales/en.ts
git commit -m "feat(auth): ProfileFilter — filterable picker for LoginPage"
```

---

## Task 6: SPA — `OnboardProfileForm` component

**Files:**
- Create: `src/components/auth/OnboardProfileForm.tsx`
- Create: `src/components/auth/OnboardProfileForm.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/auth/OnboardProfileForm.test.tsx`:

```tsx
/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../services/i18n/config'
import { lightTheme } from '@geodedb/ui-core/theme'

jest.mock('../../api/auth', () => ({
  ...jest.requireActual('../../api/auth'),
  onboardProfile: jest.fn(),
}))

import { OnboardProfileForm } from './OnboardProfileForm'
import { onboardProfile } from '../../api/auth'

const mockOnboard = onboardProfile as jest.MockedFunction<typeof onboardProfile>

function wrap(ui: React.ReactElement): React.ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>{ui}</ThemeProvider>
    </I18nextProvider>
  )
}

beforeEach(() => {
  mockOnboard.mockReset()
})

test('submit POSTs the form data and fires onSuccess with the server response', async () => {
  mockOnboard.mockResolvedValueOnce({
    profile_id: 'onb-prod',
    profile_name: 'prod',
    access_token: 'jwt-abc',
    token_type: 'bearer',
    expires_in: 3600,
    connection_id: '',
  })
  const onSuccess = jest.fn()

  render(
    wrap(<OnboardProfileForm onSuccess={onSuccess} onCancel={() => {}} />)
  )

  fireEvent.change(screen.getByTestId('onboard-name'), {
    target: { value: 'prod' },
  })
  fireEvent.change(screen.getByTestId('onboard-dsn'), {
    target: { value: 'quic://prod.example.com:3141' },
  })
  fireEvent.change(screen.getByTestId('onboard-description'), {
    target: { value: 'production cluster' },
  })
  fireEvent.change(screen.getByTestId('onboard-admin-username'), {
    target: { value: 'alice' },
  })
  fireEvent.change(screen.getByTestId('onboard-admin-password'), {
    target: { value: 'pw' },
  })
  fireEvent.click(screen.getByTestId('onboard-submit'))

  await waitFor(() => {
    expect(mockOnboard).toHaveBeenCalledWith({
      name: 'prod',
      dsn: 'quic://prod.example.com:3141',
      description: 'production cluster',
      admin_username: 'alice',
      admin_password: 'pw',
    })
  })
  await waitFor(() => {
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ profile_name: 'prod', access_token: 'jwt-abc' })
    )
  })
})

test('renders the server error message on failure', async () => {
  mockOnboard.mockRejectedValueOnce(new Error('upstream rejected the credentials'))

  render(
    wrap(<OnboardProfileForm onSuccess={() => {}} onCancel={() => {}} />)
  )

  fireEvent.change(screen.getByTestId('onboard-name'), { target: { value: 'p' } })
  fireEvent.change(screen.getByTestId('onboard-dsn'), {
    target: { value: 'quic://x:3141' },
  })
  fireEvent.change(screen.getByTestId('onboard-admin-username'), {
    target: { value: 'alice' },
  })
  fireEvent.change(screen.getByTestId('onboard-admin-password'), {
    target: { value: 'wrong' },
  })
  fireEvent.click(screen.getByTestId('onboard-submit'))

  expect(
    await screen.findByText(/upstream rejected the credentials/)
  ).toBeInTheDocument()
})

test('clicking Cancel fires onCancel and does NOT call onboardProfile', () => {
  const onCancel = jest.fn()
  render(
    wrap(<OnboardProfileForm onSuccess={() => {}} onCancel={onCancel} />)
  )
  fireEvent.click(screen.getByTestId('onboard-cancel'))
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(mockOnboard).not.toHaveBeenCalled()
})

test('Submit button is disabled while any required field is empty', () => {
  render(
    wrap(<OnboardProfileForm onSuccess={() => {}} onCancel={() => {}} />)
  )
  const submit = screen.getByTestId('onboard-submit') as HTMLButtonElement
  expect(submit).toBeDisabled()
  fireEvent.change(screen.getByTestId('onboard-name'), { target: { value: 'p' } })
  expect(submit).toBeDisabled() // dsn / username / password still empty
})
```

- [ ] **Step 2: Run, confirm failure**

```sh
npx jest src/components/auth/OnboardProfileForm.test.tsx --no-coverage
```

Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the component**

Create `src/components/auth/OnboardProfileForm.tsx`:

```tsx
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Field } from '@geodedb/ui-core'
import { onboardProfile, type OnboardResponse } from '../../api/auth'

// OnboardProfileForm — pre-authenticated profile creation. Lives on
// the LoginPage either as the first-run landing view (zero profiles
// configured) or behind an explicit Add-profile toggle.
//
// The form POSTs to /api/v1/profiles/onboard which validates the
// supplied admin credentials against the supplied DSN, persists a
// system-scope profile, and mints a JWT. onSuccess fires with the
// OnboardResponse so the parent (LoginPage) can roll straight into
// an authenticated session (the server already wrote the auth
// cookie on success; the parent typically just calls nav('/')).

const Form = styled.form`
  max-width: 380px;
  margin: 60px auto;
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.xl};
  box-shadow: ${({ theme }) => theme.shadows.md};
`

const Title = styled.h1`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xxl};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  color: ${({ theme }) => theme.text.primary};
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
`

export interface OnboardProfileFormProps {
  onSuccess: (resp: OnboardResponse) => void
  onCancel: () => void
}

export const OnboardProfileForm: React.FC<OnboardProfileFormProps> = ({
  onSuccess,
  onCancel,
}) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [dsn, setDsn] = useState('')
  const [description, setDescription] = useState('')
  const [adminUsername, setAdminUsername] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const required = (s: string): boolean => s.trim().length > 0
  const canSubmit =
    required(name) && required(dsn) && required(adminUsername) && required(adminPassword)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setErr(null)
    try {
      const resp = await onboardProfile({
        name: name.trim(),
        dsn: dsn.trim(),
        description: description.trim() || undefined,
        admin_username: adminUsername.trim(),
        admin_password: adminPassword,
      })
      onSuccess(resp)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('auth.onboardError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Form onSubmit={submit} className="p-4 d-flex flex-column gap-3">
      <Title>{t('auth.onboardTitle')}</Title>
      <p className="m-0 text-body-secondary small">{t('auth.onboardSubtitle')}</p>

      <Field label={t('auth.onboardName')} htmlFor="onboard-name" required>
        <input
          id="onboard-name"
          data-testid="onboard-name"
          className="form-control"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          required
        />
      </Field>

      <Field label={t('auth.onboardDsn')} htmlFor="onboard-dsn" required>
        <input
          id="onboard-dsn"
          data-testid="onboard-dsn"
          className="form-control"
          value={dsn}
          onChange={(e) => setDsn(e.target.value)}
          placeholder="quic://host:3141"
          maxLength={1024}
          required
        />
      </Field>

      <Field label={t('auth.onboardDescription')} htmlFor="onboard-description">
        <input
          id="onboard-description"
          data-testid="onboard-description"
          className="form-control"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={256}
        />
      </Field>

      <Field
        label={t('auth.onboardAdminUsername')}
        htmlFor="onboard-admin-username"
        required
      >
        <input
          id="onboard-admin-username"
          data-testid="onboard-admin-username"
          className="form-control"
          value={adminUsername}
          onChange={(e) => setAdminUsername(e.target.value)}
          autoComplete="username"
          required
        />
      </Field>

      <Field
        label={t('auth.onboardAdminPassword')}
        htmlFor="onboard-admin-password"
        required
      >
        <input
          id="onboard-admin-password"
          data-testid="onboard-admin-password"
          className="form-control"
          type="password"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>

      <div className="d-flex gap-2 justify-content-end mt-2">
        <button
          type="button"
          className="btn btn-outline-secondary"
          data-testid="onboard-cancel"
          onClick={onCancel}
        >
          {t('auth.onboardCancel')}
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          data-testid="onboard-submit"
          disabled={!canSubmit || busy}
        >
          {busy ? t('auth.onboardSubmitting') : t('auth.onboardSubmit')}
        </button>
      </div>

      {err && (
        <p role="alert" className="text-danger small m-0">
          {err}
        </p>
      )}
    </Form>
  )
}
```

- [ ] **Step 4: Add the i18n keys**

Inside the `auth: { ... }` block of `src/services/i18n/locales/en.ts`, add:

```ts
    onboardTitle: 'Connect a new server',
    onboardSubtitle:
      'Enter the connection details and an administrator login. We verify the credentials against the server before saving the profile.',
    onboardName: 'Profile name',
    onboardDsn: 'Connection URL',
    onboardDescription: 'Description (optional)',
    onboardAdminUsername: 'Admin username',
    onboardAdminPassword: 'Admin password',
    onboardSubmit: 'Connect & save',
    onboardSubmitting: 'Verifying…',
    onboardCancel: 'Cancel',
    onboardError: 'Could not onboard the profile.',
```

- [ ] **Step 5: Re-run tests; confirm green**

```sh
npx jest src/components/auth/OnboardProfileForm.test.tsx --no-coverage
```

Expected: 4 passing tests.

- [ ] **Step 6: Commit**

```sh
git add src/components/auth/OnboardProfileForm.tsx src/components/auth/OnboardProfileForm.test.tsx src/services/i18n/locales/en.ts
git commit -m "feat(auth): OnboardProfileForm — creds-validated profile creation"
```

---

## Task 7: SPA — LoginPage three-way branch

**Files:**
- Modify: `src/pages/LoginPage.tsx`
- Modify: `src/pages/LoginPage.test.tsx`

LoginPage now picks one of three modes:
1. **Loading** — profiles fetch in flight; existing behaviour, render nothing destructive.
2. **Onboard mode** — zero profiles AND no load error → render `OnboardProfileForm` as the landing view. Also reachable from the login form via an "Add profile" button.
3. **Login mode** — one-or-more profiles → render the new `ProfileFilter` + credentials form. An "Add another profile" link toggles to onboard mode without dropping the credentials state.

- [ ] **Step 1: Write the failing tests**

Edit `src/pages/LoginPage.test.tsx` and add three new tests at the bottom of the file:

```tsx
test('renders OnboardProfileForm when public profiles list is empty', async () => {
  // Mock fetchPublicProfiles to return [].
  const fetchSpy = jest
    .spyOn(global, 'fetch' as never)
    .mockImplementation((url: string) => {
      if (url.includes('/api/v1/profiles/public')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ profiles: [] }),
        }) as never
      }
      return Promise.reject(new Error('unexpected fetch: ' + url))
    })

  renderPage()

  expect(await screen.findByTestId('onboard-name')).toBeInTheDocument()
  expect(screen.queryByTestId('login-submit-btn')).toBeNull()
  fetchSpy.mockRestore()
})

test('renders ProfileFilter when public profiles list is non-empty', async () => {
  const fetchSpy = jest
    .spyOn(global, 'fetch' as never)
    .mockImplementation((url: string) => {
      if (url.includes('/api/v1/profiles/public')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            profiles: [
              { name: 'default', description: 'in-cluster' },
              { name: 'social', description: 'social graph' },
            ],
          }),
        }) as never
      }
      return Promise.reject(new Error('unexpected fetch: ' + url))
    })

  renderPage()

  expect(await screen.findByTestId('profile-filter-input')).toBeInTheDocument()
  expect(screen.getByTestId('profile-filter-row-default')).toBeInTheDocument()
  expect(screen.getByTestId('profile-filter-row-social')).toBeInTheDocument()
  fetchSpy.mockRestore()
})

test('clicking the Add-profile toggle on LoginPage swaps in OnboardProfileForm', async () => {
  const fetchSpy = jest
    .spyOn(global, 'fetch' as never)
    .mockImplementation((url: string) => {
      if (url.includes('/api/v1/profiles/public')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ profiles: [{ name: 'default' }] }),
        }) as never
      }
      return Promise.reject(new Error('unexpected fetch: ' + url))
    })

  renderPage()

  expect(await screen.findByTestId('profile-filter-input')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('login-add-profile'))
  expect(await screen.findByTestId('onboard-name')).toBeInTheDocument()
  expect(screen.queryByTestId('profile-filter-input')).toBeNull()
  fetchSpy.mockRestore()
})
```

(Adjust the existing `renderPage()` test helper / imports if necessary — review the file's existing setup before editing.)

- [ ] **Step 2: Run, confirm the new tests fail**

```sh
npx jest src/pages/LoginPage.test.tsx --no-coverage
```

Expected: at least three failing tests (new ones).

- [ ] **Step 3: Refactor LoginPage with the three-way branch**

Edit `src/pages/LoginPage.tsx`. Add imports at the top:

```tsx
import { ProfileFilter } from '../components/auth/ProfileFilter'
import { OnboardProfileForm } from '../components/auth/OnboardProfileForm'
```

Replace the existing `showList ? ( ... ) : ( ... )` block with a single call to `ProfileFilter`:

```tsx
{profiles && profiles.length > 0 && !loadErr ? (
  <ProfileFilter profiles={profiles} value={profile} onChange={setProfile} />
) : null}
```

Add at the top of the component body, after the existing hook setup:

```tsx
// 2026-05-21 login profile UX: three-way render branch. Zero
// profiles → onboard form as the landing view; explicit toggle
// from the login form → same form, returnable via onCancel.
const [showOnboard, setShowOnboard] = useState<boolean>(false)
const noProfiles =
  profilesState.profiles !== null &&
  profilesState.profiles.length === 0 &&
  !profilesState.loadErr
```

Replace the existing `return ( <Form ...> ... </Form> )` block with:

```tsx
if (showOnboard || noProfiles) {
  return (
    <OnboardProfileForm
      onSuccess={() => {
        // Server already wrote the auth cookie; navigate to the
        // protected shell. AuthProvider rehydrates the session
        // posture from /api/v1/auth/whoami on next mount.
        nav('/', { replace: true })
      }}
      onCancel={() => setShowOnboard(false)}
    />
  )
}

return (
  <Form onSubmit={submit} className="p-4 d-flex flex-column gap-3">
    {/* keep the existing form body up to where the profile picker used
        to render — the ProfileFilter call replaces the old showList
        ternary. The rest of the form (username, password, save-pw,
        submit, error) stays unchanged. */}
    {/* ...existing logo + title + fields... */}

    {/* Below the submit button, insert: */}
    <button
      type="button"
      className="btn btn-link btn-sm p-0 align-self-start"
      data-testid="login-add-profile"
      onClick={() => setShowOnboard(true)}
    >
      {t('auth.loginAddProfile')}
    </button>
  </Form>
)
```

Add the new i18n key to `src/services/i18n/locales/en.ts` inside the `auth: { ... }` block:

```ts
    loginAddProfile: '+ Add a new profile',
```

- [ ] **Step 4: Re-run the test file; confirm green**

```sh
npx jest src/pages/LoginPage.test.tsx --no-coverage
```

Expected: all tests pass (existing + 3 new).

- [ ] **Step 5: Commit**

```sh
git add src/pages/LoginPage.tsx src/pages/LoginPage.test.tsx src/services/i18n/locales/en.ts
git commit -m "feat(auth): LoginPage three-way branch (filter / onboard / add toggle)"
```

---

## Task 8: E2E — Onboarding flow against the live two-Geode stack

**Files:**
- Create: `e2e/specs/39-profile-onboarding.spec.ts`

- [ ] **Step 1: Write the failing spec**

Create `e2e/specs/39-profile-onboarding.spec.ts`:

```ts
// e2e/specs/39-profile-onboarding.spec.ts
//
// Onboard flow against the live compose stack. Asserts that POST
// /api/v1/profiles/onboard:
//   - rejects bad creds (no profile written)
//   - accepts good creds (profile appears in /api/v1/profiles/public
//     on the next fetch)

import { test, expect } from '@playwright/test'

const GOOD_USER = 'geode'
const GOOD_PASS = 'Geode E2E Bootstrap Password 2024'
const DSN = 'quic://geode:3141'

test('rejects an onboard attempt with wrong upstream credentials', async ({
  request,
}) => {
  const res = await request.post('/api/v1/profiles/onboard', {
    data: {
      name: 'rejected-profile',
      dsn: DSN,
      description: 'should not persist',
      admin_username: GOOD_USER,
      admin_password: 'definitely-not-the-password',
    },
  })
  expect(res.status()).toBe(401)
  // /api/v1/profiles/public is anonymous, so we can verify the
  // rejected profile did NOT land.
  const list = await request.get('/api/v1/profiles/public')
  const body = await list.json()
  const names = (body.profiles as Array<{ name: string }>).map((p) => p.name)
  expect(names).not.toContain('rejected-profile')
})

test('accepts an onboard with good creds and the new profile appears in /profiles/public', async ({
  request,
}) => {
  const name = `onb-${Date.now()}`
  const res = await request.post('/api/v1/profiles/onboard', {
    data: {
      name,
      dsn: DSN,
      description: 'created by 39-profile-onboarding.spec.ts',
      admin_username: GOOD_USER,
      admin_password: GOOD_PASS,
    },
  })
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.profile_name).toBe(name)
  expect(typeof body.access_token).toBe('string')
  // /profiles/public reflects the new profile.
  const list = await request.get('/api/v1/profiles/public')
  const names = (await list.json()).profiles.map((p: { name: string }) => p.name)
  expect(names).toContain(name)
})
```

- [ ] **Step 2: Verify the stack is running**

```sh
docker ps --format '{{.Names}}\t{{.Status}}' | grep geode-e2e
curl -sS http://localhost:8080/healthz
```

Expected: all containers healthy, `{"status":"ok",...}`.

- [ ] **Step 3: Run the new spec**

```sh
npx playwright test --config=e2e/playwright.config.ts e2e/specs/39-profile-onboarding.spec.ts
```

Expected: 2 passing tests.

- [ ] **Step 4: Commit**

```sh
git add e2e/specs/39-profile-onboarding.spec.ts
git commit -m "test(e2e): onboarding flow against the live compose stack"
```

---

## Task 9: Validation + push

- [ ] **Step 1: Run the full server test suite**

```sh
GOEXPERIMENT=jsonv2 go test ./... -count=1
```

Expected: green.

- [ ] **Step 2: Run the full Jest suite**

```sh
npm test -- --ci
```

Expected: green; coverage ratchets pass.

- [ ] **Step 3: Typecheck + lint**

```sh
npx tsc --noEmit
npx eslint src/ e2e/
```

Expected: 0 errors.

- [ ] **Step 4: Rebuild the geode-ui container so the live stack picks up the new flow**

```sh
cd -P .. && docker build -f geode-ui/deploy/Dockerfile -t geode-ui:e2e .
cd -P - && docker compose -f deploy/docker-compose.test.yml --env-file deploy/.env.test up -d --no-deps geode-ui
curl -sS http://localhost:8080/healthz
```

Expected: rebuild succeeds, container recreated, `/healthz` returns ok.

- [ ] **Step 5: Manual smoke against the live UI**

Open http://localhost:8080 in a private browser window:

1. Wait for the login screen. Confirm the new filterable picker renders with both `default` and `social` profile rows.
2. Type `social` in the filter — only the `social` row should remain.
3. Click `+ Add a new profile`. Confirm the OnboardProfileForm replaces the form.
4. Click Cancel — back to the login screen with the filter intact.
5. (Destructive smoke — optional) Stop the stack with `make e2e-down`, drop the geode-ui-uploads volume, restart with `make e2e-up`. With the volume reset and profiles.json still mounted, the first-run path is hard to demo without ALSO unmounting profiles.json; mark this step done after confirming the filter + add-toggle paths.

- [ ] **Step 6: Push**

```sh
git push origin main
```

Expected: pre-push gauntlet (golangci-lint / tsc / go test -race / jest --ci / make generate / webpack prod / go build) passes; remote updates.

---

## Self-Review

**Spec coverage:**
- "More UX friendly … large list of profiles" → Tasks 5 (ProfileFilter) + 7 (LoginPage integration).
- "Ability to add new profiles from the login screen" → Tasks 1–4 (server endpoint + API helper) + 6 (OnboardProfileForm) + 7 (toggle button).
- "If there are no profiles in the system then starting screen should be the add profile screen" → Task 7 (`noProfiles` branch in LoginPage).
- E2E coverage: Task 8.

**Placeholder scan:**
- No `TBD`/`TODO`/"fill in" left in the steps. The Task 2 server impl has a transient `TODO(next task)` ONLY in Step 3 of Task 1, replaced verbatim in Task 2 Step 5 — that's a legitimate WIP marker scoped to the same plan.

**Type consistency:**
- `OnboardRequest` / `OnboardResponse` shapes are identical across Task 1 (server type), Task 4 (API helper), Task 6 (form submission), Task 8 (e2e payload). Field names (`admin_username`, `admin_password`, `profile_id`, etc.) match end-to-end.
- `PublicProfile` is imported from `src/api/auth.ts` (an existing export) in both Task 5 (ProfileFilter) and Task 7 (LoginPage).
- `ProfileFilter` props (`profiles`, `value`, `onChange`) match between Task 5 implementation and Task 7 integration.

No issues found.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-21-login-profile-ux.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
