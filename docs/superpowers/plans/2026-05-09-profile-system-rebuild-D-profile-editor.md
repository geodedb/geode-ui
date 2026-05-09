# Profile System Rebuild — Plan D: Profile Editor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full CRUD UI for profiles. New `/profiles` page lists system + the user's personal profiles with role-aware affordances. A `ProfileEditorModal` covers create + edit with all fields (basic, TLS material as PEM textareas, pool tuning, saved username, default flag). Delete is gated through a confirmation modal. Server-side, `mergeProfile`'s sticky-true on Default is dropped so the SPA can clear the flag through the existing PATCH endpoint — no new API surface needed.

**Architecture:**
- **Server**: one-line change to `internal/profilestore/sqlite.go` so `Patch` honours `Default: false` (drops the sticky-true semantic). The wire-shape stays identical; the only change is interpretation. `UpdateProfileReq.IsDefault` is a non-pointer `bool`, so callers MUST send the desired value (the SPA always does — it's bound to a checkbox state).
- **SPA**: new `src/api/profiles.ts` provides typed helpers wrapping the genapi client (list, get, create, update, delete) plus shape-conversion between the wire's `jsontext.Value` for `tls`/`pool_overrides` and the SPA's typed equivalents. `ProfilesPage` lives at `/profiles`, listed in the Shell's nav. `ProfileEditorModal` is the create/edit form. `DeleteProfileModal` is the confirmation. Default-flag enforcement (one default per scope+owner) is handled SPA-side: when the user marks a profile as default, the editor first PATCHes the previous default to `is_default: false` then PATCHes the new one to `is_default: true`. The server makes no atomicity guarantees; a failure between the two PATCHes leaves the user with zero defaults until they retry — acceptable for v0.
- **Permissions UX**: admin can create/edit/delete any system or personal profile; owner can create/edit/delete their own personal profiles; everyone can VIEW system profiles (with redaction matching Plan A's `toGenProfile(reveal=false)`). The list filters DSN/TLS/pool-override columns to admins only.

**Tech Stack:** Go 1.26 + `GOEXPERIMENT=jsonv2`; React 18 + styled-components; existing `Modal`, `Field`, `Input`, `Button` from `src/components/ui/`; Jest + @testing-library/react.

---

## File Structure

**Create**
- `src/api/profiles.ts` — typed wrapper around the genapi profile client + jsontext.Value ↔ typed conversion
- `src/api/profiles.test.ts`
- `src/pages/ProfilesPage.tsx`
- `src/pages/ProfilesPage.test.tsx`
- `src/components/profiles/ProfileEditorModal.tsx`
- `src/components/profiles/ProfileEditorModal.test.tsx`
- `src/components/profiles/DeleteProfileModal.tsx`
- `src/components/profiles/DeleteProfileModal.test.tsx`

**Modify**
- `internal/profilestore/sqlite.go` — drop sticky-true on Default in `mergeProfile`
- `internal/profilestore/sqlite_test.go` — add `TestSQLitePatchClearsDefault`
- `src/App.tsx` — add `/profiles` route inside `<ProtectedRoute>`
- `src/components/layout/Shell.tsx` — add nav link
- `src/services/i18n/locales/en.ts` — many new keys (~15)

---

## Task 1: Server — drop sticky-true on `Default` in `mergeProfile` (TDD)

**Files:** `internal/profilestore/sqlite.go`, `internal/profilestore/sqlite_test.go`

The current `mergeProfile` cannot clear the default flag via PATCH. Plan D's editor needs that.

- [ ] **Step 1: Append the failing test**

```go
func TestSQLitePatchClearsDefault(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "p1", DSN: "stub://x", Default: true,
	})
	if !saved.Default {
		t.Fatalf("Put: Default not stored as true: %+v", saved)
	}
	updated, err := st.Patch(context.Background(), saved.ID, conn.Profile{
		Default: false,
	})
	if err != nil {
		t.Fatalf("Patch clearing default: %v", err)
	}
	if updated.Default {
		t.Errorf("Patch with Default=false did not clear: %+v", updated)
	}
}
```

- [ ] **Step 2: Run failing test** — `scripts/run-go.sh test ./internal/profilestore/ -run TestSQLitePatchClearsDefault -v`. Expected: FAIL because sticky-true keeps `Default=true` after the patch.

- [ ] **Step 3: Update `mergeProfile`** in `internal/profilestore/sqlite.go`:

Replace:

```go
if patch.Default {
    out.Default = true
}
```

with:

```go
out.Default = patch.Default
```

Also update the doc comment block above `mergeProfile` to drop the sticky-true paragraph and replace with:

```go
// mergeProfile applies non-zero fields of patch over cur. The Default
// flag is overwritten verbatim (true OR false) so callers can clear
// it via PATCH. Callers that want "leave Default alone" must read the
// current value first and re-send it (the SPA editor binds Default to
// a checkbox state and always sends the user's intent).
```

- [ ] **Step 4: Verify behaviour for the existing default tests**

```
scripts/run-go.sh test ./internal/profilestore/ -v
```

Expected: all PASS, including `TestSQLitePatchUpdatesFields` (which doesn't set `Default` in the patch, so the merge sets it to `false` — IF the original was true that test would now fail).

If a test fails because it implicitly relied on the sticky-true behaviour, update it to send the desired Default value explicitly.

- [ ] **Step 5: Commit**

```bash
git add internal/profilestore/sqlite.go internal/profilestore/sqlite_test.go
git commit -m "fix(profilestore): mergeProfile honours Default=false (drop sticky-true)"
```

---

## Task 2: SPA — `src/api/profiles.ts` typed helpers (TDD)

**Files:** `src/api/profiles.ts` (new), `src/api/profiles.test.ts` (new)

Wrap the genapi-emitted client (`getProfiles`, `postProfiles`, `getProfileid`, `patchProfileid`, `deleteProfileid`) with typed helpers that convert between the wire's `jsontext.Value` shape for `tls`/`pool_overrides` and the SPA's typed structs.

The genapi-emitted `Profile` type has `tls?: jsontext.Value` and `pool_overrides?: jsontext.Value` (raw JSON); the SPA wants `tls?: TLSMaterial` and `poolOverrides?: PoolOverrides` (typed objects). This module is the boundary.

- [ ] **Step 1: Write the failing test**

```ts
import {
  ProfileApiTypes,
  fromWireProfile,
  toWireCreateRequest,
  toWireUpdateRequest,
} from './profiles'

test('fromWireProfile parses tls and pool_overrides from jsontext.Value', () => {
  const wire = {
    id: 'abc',
    scope: 'personal',
    owner_user_id: 'alice',
    name: 'p1',
    dsn: 'quic://x',
    description: 'desc',
    saved_username: 'alice',
    is_default: true,
    tls: '{"ca_pem":"---CA---","client_cert_pem":"","client_key_pem":""}',
    pool_overrides: '{"max_open_conns":32,"conn_max_lifetime_ms":90000}',
  }
  const got = fromWireProfile(wire)
  expect(got.id).toBe('abc')
  expect(got.scope).toBe('personal')
  expect(got.tls?.caPem).toBe('---CA---')
  expect(got.poolOverrides?.maxOpenConns).toBe(32)
  expect(got.poolOverrides?.connMaxLifetimeMs).toBe(90_000)
})

test('toWireCreateRequest serialises tls/pool_overrides as JSON strings', () => {
  const got = toWireCreateRequest({
    scope: 'system',
    name: 'p',
    dsn: 'quic://x:1',
    isDefault: false,
    tls: { caPem: 'CA' },
    poolOverrides: { maxOpenConns: 16 },
  })
  expect(got.scope).toBe('system')
  expect(typeof got.tls).toBe('string')
  expect(JSON.parse(got.tls as string)).toEqual({ ca_pem: 'CA' })
  expect(JSON.parse(got.pool_overrides as string)).toEqual({ max_open_conns: 16 })
})

test('toWireUpdateRequest omits keys that were not provided', () => {
  const got = toWireUpdateRequest({ description: 'new' })
  expect(got.description).toBe('new')
  expect(got.tls).toBeUndefined()
  expect(got.pool_overrides).toBeUndefined()
})
```

- [ ] **Step 2: Run failing test** — `npx jest src/api/profiles.test.ts`. Expected: module not found.

- [ ] **Step 3: Implement `src/api/profiles.ts`**

```ts
// eslint-disable-next-line import/no-unresolved
import { client } from './client'

export type Scope = 'system' | 'personal'

export interface TLSMaterial {
  caPem?: string
  clientCertPem?: string
  clientKeyPem?: string
}

export interface PoolOverrides {
  maxOpenConns?: number
  maxIdleConns?: number
  connMaxLifetimeMs?: number
  connMaxIdleMs?: number
}

export interface ProfileView {
  id: string
  scope: Scope
  ownerUserId?: string
  name: string
  dsn?: string
  description?: string
  savedUsername?: string
  isDefault: boolean
  tls?: TLSMaterial
  poolOverrides?: PoolOverrides
}

export interface CreateProfileInput {
  scope: Scope
  name: string
  dsn: string
  description?: string
  savedUsername?: string
  isDefault: boolean
  tls?: TLSMaterial
  poolOverrides?: PoolOverrides
}

export type UpdateProfileInput = Partial<Omit<CreateProfileInput, 'scope'>>

// genapi emits tls/pool_overrides as `jsontext.Value` which the TS
// client surfaces as `string` (raw JSON); we parse/stringify here.

export function fromWireProfile(wire: any): ProfileView {
  const tlsRaw = typeof wire.tls === 'string' && wire.tls.length > 0 ? wire.tls : null
  const poRaw = typeof wire.pool_overrides === 'string' && wire.pool_overrides.length > 0 ? wire.pool_overrides : null
  const tlsObj = tlsRaw ? JSON.parse(tlsRaw) : null
  const poObj = poRaw ? JSON.parse(poRaw) : null
  return {
    id: wire.id ?? '',
    scope: (wire.scope ?? 'system') as Scope,
    ownerUserId: wire.owner_user_id || undefined,
    name: wire.name ?? '',
    dsn: wire.dsn || undefined,
    description: wire.description || undefined,
    savedUsername: wire.saved_username || undefined,
    isDefault: !!wire.is_default,
    tls: tlsObj
      ? {
          caPem: tlsObj.ca_pem || undefined,
          clientCertPem: tlsObj.client_cert_pem || undefined,
          clientKeyPem: tlsObj.client_key_pem || undefined,
        }
      : undefined,
    poolOverrides: poObj
      ? {
          maxOpenConns: poObj.max_open_conns,
          maxIdleConns: poObj.max_idle_conns,
          connMaxLifetimeMs: poObj.conn_max_lifetime_ms,
          connMaxIdleMs: poObj.conn_max_idle_ms,
        }
      : undefined,
  }
}

function tlsToWire(t?: TLSMaterial): string | undefined {
  if (!t) return undefined
  const obj: Record<string, string> = {}
  if (t.caPem) obj.ca_pem = t.caPem
  if (t.clientCertPem) obj.client_cert_pem = t.clientCertPem
  if (t.clientKeyPem) obj.client_key_pem = t.clientKeyPem
  return Object.keys(obj).length === 0 ? undefined : JSON.stringify(obj)
}

function poToWire(o?: PoolOverrides): string | undefined {
  if (!o) return undefined
  const obj: Record<string, number> = {}
  if (o.maxOpenConns !== undefined) obj.max_open_conns = o.maxOpenConns
  if (o.maxIdleConns !== undefined) obj.max_idle_conns = o.maxIdleConns
  if (o.connMaxLifetimeMs !== undefined) obj.conn_max_lifetime_ms = o.connMaxLifetimeMs
  if (o.connMaxIdleMs !== undefined) obj.conn_max_idle_ms = o.connMaxIdleMs
  return Object.keys(obj).length === 0 ? undefined : JSON.stringify(obj)
}

export function toWireCreateRequest(input: CreateProfileInput): any {
  return {
    scope: input.scope,
    name: input.name,
    dsn: input.dsn,
    description: input.description ?? '',
    saved_username: input.savedUsername ?? '',
    is_default: input.isDefault,
    tls: tlsToWire(input.tls),
    pool_overrides: poToWire(input.poolOverrides),
  }
}

export function toWireUpdateRequest(input: UpdateProfileInput): any {
  const out: any = {}
  if (input.name !== undefined) out.name = input.name
  if (input.dsn !== undefined) out.dsn = input.dsn
  if (input.description !== undefined) out.description = input.description
  if (input.savedUsername !== undefined) out.saved_username = input.savedUsername
  if (input.isDefault !== undefined) out.is_default = input.isDefault
  if (input.tls !== undefined) out.tls = tlsToWire(input.tls)
  if (input.poolOverrides !== undefined) out.pool_overrides = poToWire(input.poolOverrides)
  return out
}

// Higher-level helpers used by the page + editor.
export async function listProfiles(): Promise<ProfileView[]> {
  const r = await client.getProfiles({})
  return (r.profiles ?? []).map(fromWireProfile)
}

export async function createProfile(input: CreateProfileInput): Promise<ProfileView> {
  const r = await client.postProfiles(toWireCreateRequest(input))
  return fromWireProfile(r)
}

export async function updateProfile(id: string, input: UpdateProfileInput): Promise<ProfileView> {
  const wire = toWireUpdateRequest(input)
  // The PATCH endpoint reads the id from r.PathValue("profileId"); the
  // generated client takes the id as part of the wire URL substitution.
  // Verify by reading gen/client/react/client.ts for patchProfileid's
  // signature — typically it accepts an object containing profile_id.
  const r = await client.patchProfileid({ ...wire, profile_id: id })
  return fromWireProfile(r)
}

export async function deleteProfile(id: string): Promise<void> {
  await client.deleteProfileid({ profile_id: id })
}

// ProfileApiTypes is exported as a sentinel so the test file's import
// shape works without depending on the inferred surface.
export const ProfileApiTypes = {} as const
```

> **NOTE:** Read `gen/client/react/client.ts` to confirm the exact arg shape for `patchProfileid` and `deleteProfileid`. The path-param form (with the `{profile_id}` token) means the genapi client may take it as a top-level field on the request object. If the client signature is `client.patchProfileid(req: ProfileIDPath & UpdateProfileReq)`, the spread above is correct. If the client emits `client.patchProfileid(profile_id: string, body: UpdateProfileReq)`, change the implementation to match.

- [ ] **Step 4: Run the test, expect PASS** — `npx jest src/api/profiles.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/api/profiles.ts src/api/profiles.test.ts
git commit -m "feat(spa): typed profile API helpers + tls/pool_overrides conversion"
```

---

## Task 3: SPA — `ProfilesPage` skeleton with read-only list (TDD)

**Files:** `src/pages/ProfilesPage.tsx`, `src/pages/ProfilesPage.test.tsx`, `src/services/i18n/locales/en.ts`

A new page at `/profiles` lists all visible profiles. Each row shows: name, scope badge, description, owner (for personal profiles), default-flag badge, and per-row buttons (visible based on role/ownership): Edit, Delete, Set Default.

This task delivers the read-only list with role-aware action buttons. The actions wire to no-op handlers for now — Tasks 4-6 fill them in.

- [ ] **Step 1: Add i18n keys**

```ts
'profiles.title': 'Profiles',
'profiles.description': 'Manage Geode connection profiles. System profiles are visible to everyone; personal profiles are scoped to you.',
'profiles.actions.create': 'Create profile',
'profiles.actions.edit': 'Edit',
'profiles.actions.delete': 'Delete',
'profiles.actions.setDefault': 'Set as default',
'profiles.scope.system': 'System',
'profiles.scope.personal': 'Personal',
'profiles.flag.default': 'Default',
'profiles.column.name': 'Name',
'profiles.column.scope': 'Scope',
'profiles.column.description': 'Description',
'profiles.column.owner': 'Owner',
'profiles.empty': 'No profiles yet.',
'profiles.loading': 'Loading profiles…',
'profiles.error': 'Could not load profiles.',
```

- [ ] **Step 2: Write the failing test**

```tsx
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'
import i18n from '../services/i18n/config'
import { lightTheme } from '../theme'
import { ConnectionsProvider } from '../api/connections'
import { ProfilesPage } from './ProfilesPage'

jest.mock('../api/profiles', () => ({
  ...jest.requireActual('../api/profiles'),
  listProfiles: jest.fn(),
}))

const mockList = jest.requireMock('../api/profiles').listProfiles as jest.Mock

const renderPage = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>
        <ConnectionsProvider>
          <MemoryRouter>
            <ProfilesPage />
          </MemoryRouter>
        </ConnectionsProvider>
      </ThemeProvider>
    </I18nextProvider>
  )

beforeEach(() => mockList.mockReset())

test('shows loading then renders fetched profiles', async () => {
  mockList.mockResolvedValueOnce([
    { id: 'a', scope: 'system', name: 'prod', description: 'Production', isDefault: true },
    { id: 'b', scope: 'personal', ownerUserId: 'alice', name: 'alice-dev', isDefault: false },
  ])
  renderPage()
  await waitFor(() => expect(screen.getByText('prod')).toBeInTheDocument())
  expect(screen.getByText('alice-dev')).toBeInTheDocument()
  // Default badge appears on prod.
  expect(screen.getAllByText(/default/i).length).toBeGreaterThanOrEqual(1)
})

test('renders empty state when no profiles returned', async () => {
  mockList.mockResolvedValueOnce([])
  renderPage()
  await waitFor(() => expect(screen.getByText(/no profiles yet/i)).toBeInTheDocument())
})

test('renders error state on listProfiles failure', async () => {
  mockList.mockRejectedValueOnce(new Error('boom'))
  renderPage()
  await waitFor(() => expect(screen.getByText(/could not load profiles/i)).toBeInTheDocument())
})
```

- [ ] **Step 3: Run failing test** — `npx jest src/pages/ProfilesPage.test.tsx`. Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/pages/ProfilesPage.tsx`**

```tsx
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { listProfiles, ProfileView } from '../api/profiles'

const Page = styled.section`
  max-width: 1024px;
  margin: 0 auto;
  padding: ${({ theme }) => theme.spacing.lg};
`
const Header = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`
const Title = styled.h1`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xxl};
  margin: 0;
`
const Description = styled.p`
  color: ${({ theme }) => theme.text.secondary};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  margin: 4px 0 0 0;
`
const Status = styled.p`
  color: ${({ theme }) => theme.text.secondary};
  margin-top: ${({ theme }) => theme.spacing.lg};
`
const ErrorText = styled.p`
  color: ${({ theme }) => theme.text.danger};
  margin-top: ${({ theme }) => theme.spacing.lg};
`
const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  th, td {
    text-align: left;
    padding: ${({ theme }) => theme.spacing.sm};
    border-bottom: 1px solid ${({ theme }) => theme.border.default};
  }
  th { font-weight: 600; color: ${({ theme }) => theme.text.secondary}; }
`
const Badge = styled.span<{ $kind: 'system' | 'personal' | 'default' }>`
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: ${({ theme }) => theme.font.sizes.xs};
  background: ${({ theme, $kind }) =>
    $kind === 'default' ? theme.colors.primary : theme.bg.subtle};
  color: ${({ theme, $kind }) =>
    $kind === 'default' ? theme.text.onPrimary : theme.text.primary};
`

export const ProfilesPage: React.FC = () => {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState<ProfileView[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setErr(null)
    try {
      const list = await listProfiles()
      setProfiles(list)
    } catch (e: unknown) {
      setProfiles([])
      setErr(e instanceof Error ? e.message : t('profiles.error'))
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (profiles === null) {
    return (
      <Page>
        <Header>
          <Title>{t('profiles.title')}</Title>
        </Header>
        <Status>{t('profiles.loading')}</Status>
      </Page>
    )
  }
  if (err) {
    return (
      <Page>
        <Header>
          <Title>{t('profiles.title')}</Title>
        </Header>
        <ErrorText>{t('profiles.error')}</ErrorText>
      </Page>
    )
  }
  if (profiles.length === 0) {
    return (
      <Page>
        <Header>
          <Title>{t('profiles.title')}</Title>
          <Description>{t('profiles.description')}</Description>
        </Header>
        <Status>{t('profiles.empty')}</Status>
      </Page>
    )
  }

  return (
    <Page>
      <Header>
        <div>
          <Title>{t('profiles.title')}</Title>
          <Description>{t('profiles.description')}</Description>
        </div>
      </Header>
      <Table>
        <thead>
          <tr>
            <th>{t('profiles.column.name')}</th>
            <th>{t('profiles.column.scope')}</th>
            <th>{t('profiles.column.description')}</th>
            <th>{t('profiles.column.owner')}</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id}>
              <td>
                <strong>{p.name}</strong>
                {p.isDefault ? (
                  <>{' '}<Badge $kind="default">{t('profiles.flag.default')}</Badge></>
                ) : null}
              </td>
              <td>
                <Badge $kind={p.scope}>{t(`profiles.scope.${p.scope}`)}</Badge>
              </td>
              <td>{p.description ?? ''}</td>
              <td>{p.ownerUserId ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Page>
  )
}
```

> Theme tokens used: `colors.primary`, `text.onPrimary`, `text.primary`, `text.secondary`, `text.danger`, `bg.subtle`, `border.default`, `font.family.display`, `font.sizes.xs/sm/xxl`, `spacing.sm/md/lg`. If `text.onPrimary` doesn't exist on the Theme type, substitute the matching token (likely `text.inverse` or a hex from the theme palette). Read `src/theme/light.ts` first.

- [ ] **Step 5: Run test, expect PASS** — `npx jest src/pages/ProfilesPage.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ProfilesPage.tsx src/pages/ProfilesPage.test.tsx src/services/i18n/locales/
git commit -m "feat(spa): ProfilesPage skeleton with read-only list"
```

---

## Task 4: SPA — `ProfileEditorModal` create flow (TDD)

**Files:** `src/components/profiles/ProfileEditorModal.tsx` (new), `src/components/profiles/ProfileEditorModal.test.tsx` (new), `src/services/i18n/locales/en.ts`

A modal with the full set of fields used for both create and edit. This task implements **create**; Task 5 adds the edit flow on top of the same component.

- [ ] **Step 1: Add i18n keys**

```ts
'profiles.editor.create.title': 'Create profile',
'profiles.editor.field.name': 'Name',
'profiles.editor.field.dsn': 'DSN',
'profiles.editor.field.description': 'Description',
'profiles.editor.field.savedUsername': 'Saved username (optional)',
'profiles.editor.field.scope': 'Scope',
'profiles.editor.field.isDefault': 'Default for this scope',
'profiles.editor.section.tls': 'TLS material (optional)',
'profiles.editor.field.caPem': 'CA PEM',
'profiles.editor.field.clientCertPem': 'Client certificate PEM',
'profiles.editor.field.clientKeyPem': 'Client key PEM',
'profiles.editor.section.pool': 'Pool tuning (optional — leave blank for server defaults)',
'profiles.editor.field.maxOpenConns': 'Max open connections',
'profiles.editor.field.maxIdleConns': 'Max idle connections',
'profiles.editor.field.connMaxLifetimeMs': 'Max connection lifetime (ms)',
'profiles.editor.field.connMaxIdleMs': 'Max idle time (ms)',
'profiles.editor.actions.save': 'Save',
'profiles.editor.actions.cancel': 'Cancel',
'profiles.editor.error.required': '{{field}} is required',
```

- [ ] **Step 2: Write the failing test**

```tsx
import React from 'react'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../services/i18n/config'
import { lightTheme } from '../../theme'
import { ProfileEditorModal } from './ProfileEditorModal'

jest.mock('../../api/profiles', () => ({
  ...jest.requireActual('../../api/profiles'),
  createProfile: jest.fn(),
}))

const mockCreate = jest.requireMock('../../api/profiles').createProfile as jest.Mock

const renderEditor = (open: boolean, onClose: () => void, onSaved: () => void) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>
        <ProfileEditorModal mode="create" open={open} onClose={onClose} onSaved={onSaved} isAdmin />
      </ThemeProvider>
    </I18nextProvider>
  )

beforeEach(() => mockCreate.mockReset())

test('create — required fields gate the submit', async () => {
  const onClose = jest.fn()
  const onSaved = jest.fn()
  renderEditor(true, onClose, onSaved)
  // Try to submit without filling Name + DSN. The form's required HTML5
  // validation should prevent the submit handler from firing.
  const form = screen.getByLabelText(/name/i).closest('form')!
  fireEvent.submit(form)
  expect(mockCreate).not.toHaveBeenCalled()
})

test('create — happy path posts the typed input and calls onSaved', async () => {
  const onClose = jest.fn()
  const onSaved = jest.fn()
  mockCreate.mockResolvedValueOnce({ id: 'new-id' })
  renderEditor(true, onClose, onSaved)
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'p1' } })
  fireEvent.change(screen.getByLabelText(/^dsn$/i), { target: { value: 'quic://x:1' } })
  fireEvent.change(screen.getByLabelText(/scope/i), { target: { value: 'personal' } })
  await act(async () => {
    fireEvent.submit(screen.getByLabelText(/name/i).closest('form')!)
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ scope: 'personal', name: 'p1', dsn: 'quic://x:1' })
  )
  expect(onSaved).toHaveBeenCalled()
  expect(onClose).toHaveBeenCalled()
})
```

- [ ] **Step 3: Run failing test** — module not found.

- [ ] **Step 4: Implement `ProfileEditorModal.tsx`** with create-only support (the `mode` prop accepts `'create' | 'edit'` but the edit branch is a stub returning `null` for now; Task 5 fills it in).

```tsx
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Button, Field, Input, Modal } from '../ui'
import {
  CreateProfileInput,
  ProfileView,
  Scope,
  createProfile,
} from '../../api/profiles'

const Section = styled.section`
  margin-top: ${({ theme }) => theme.spacing.md};
  border-top: 1px solid ${({ theme }) => theme.border.default};
  padding-top: ${({ theme }) => theme.spacing.md};
`
const SectionTitle = styled.h3`
  font-size: ${({ theme }) => theme.font.sizes.sm};
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
`
const TextArea = styled.textarea`
  width: 100%;
  min-height: 80px;
  font-family: ${({ theme }) => theme.font.family.mono};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  padding: 6px 8px;
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.bg.surface};
  color: ${({ theme }) => theme.text.primary};
  resize: vertical;
`
const Number = styled(Input).attrs({ type: 'number' })``
const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.sm};
`
const ButtonRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  justify-content: flex-end;
  margin-top: ${({ theme }) => theme.spacing.lg};
`
const ErrText = styled.p`
  color: ${({ theme }) => theme.text.danger};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

export interface Props {
  mode: 'create' | 'edit'
  open: boolean
  onClose: () => void
  onSaved: () => void
  isAdmin: boolean
  // For edit mode (Task 5):
  profile?: ProfileView
}

interface FormState {
  scope: Scope
  name: string
  dsn: string
  description: string
  savedUsername: string
  isDefault: boolean
  caPem: string
  clientCertPem: string
  clientKeyPem: string
  maxOpenConns: string
  maxIdleConns: string
  connMaxLifetimeMs: string
  connMaxIdleMs: string
}

const empty: FormState = {
  scope: 'personal',
  name: '',
  dsn: '',
  description: '',
  savedUsername: '',
  isDefault: false,
  caPem: '',
  clientCertPem: '',
  clientKeyPem: '',
  maxOpenConns: '',
  maxIdleConns: '',
  connMaxLifetimeMs: '',
  connMaxIdleMs: '',
}

function buildCreateInput(s: FormState): CreateProfileInput {
  const numOrUndef = (v: string) => (v === '' ? undefined : Number(v))
  return {
    scope: s.scope,
    name: s.name,
    dsn: s.dsn,
    description: s.description || undefined,
    savedUsername: s.savedUsername || undefined,
    isDefault: s.isDefault,
    tls: (s.caPem || s.clientCertPem || s.clientKeyPem)
      ? {
          caPem: s.caPem || undefined,
          clientCertPem: s.clientCertPem || undefined,
          clientKeyPem: s.clientKeyPem || undefined,
        }
      : undefined,
    poolOverrides:
      s.maxOpenConns || s.maxIdleConns || s.connMaxLifetimeMs || s.connMaxIdleMs
        ? {
            maxOpenConns: numOrUndef(s.maxOpenConns),
            maxIdleConns: numOrUndef(s.maxIdleConns),
            connMaxLifetimeMs: numOrUndef(s.connMaxLifetimeMs),
            connMaxIdleMs: numOrUndef(s.connMaxIdleMs),
          }
        : undefined,
  }
}

export const ProfileEditorModal: React.FC<Props> = ({
  mode, open, onClose, onSaved, isAdmin,
}) => {
  const { t } = useTranslation()
  const [s, setS] = useState<FormState>(empty)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (mode === 'edit') {
    // Task 5 wires this branch.
    return null
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await createProfile(buildCreateInput(s))
      setS(empty)
      onSaved()
      onClose()
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : 'Failed to save profile')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('profiles.editor.create.title')}>
      <form onSubmit={submit}>
        <Field label={t('profiles.editor.field.scope')} htmlFor="profile-scope">
          <select
            id="profile-scope"
            value={s.scope}
            onChange={(e) => setS({ ...s, scope: e.target.value as Scope })}
          >
            <option value="personal">{t('profiles.scope.personal')}</option>
            {isAdmin ? (
              <option value="system">{t('profiles.scope.system')}</option>
            ) : null}
          </select>
        </Field>
        <Field label={t('profiles.editor.field.name')} htmlFor="profile-name" required>
          <Input
            id="profile-name"
            value={s.name}
            onChange={(e) => setS({ ...s, name: e.target.value })}
            required
            maxLength={64}
          />
        </Field>
        <Field label={t('profiles.editor.field.dsn')} htmlFor="profile-dsn" required>
          <Input
            id="profile-dsn"
            value={s.dsn}
            onChange={(e) => setS({ ...s, dsn: e.target.value })}
            required
            maxLength={1024}
          />
        </Field>
        <Field label={t('profiles.editor.field.description')} htmlFor="profile-description">
          <Input
            id="profile-description"
            value={s.description}
            onChange={(e) => setS({ ...s, description: e.target.value })}
            maxLength={256}
          />
        </Field>
        <Field label={t('profiles.editor.field.savedUsername')} htmlFor="profile-savedUsername">
          <Input
            id="profile-savedUsername"
            value={s.savedUsername}
            onChange={(e) => setS({ ...s, savedUsername: e.target.value })}
            maxLength={128}
          />
        </Field>
        <Field label={t('profiles.editor.field.isDefault')} htmlFor="profile-isDefault">
          <input
            id="profile-isDefault"
            type="checkbox"
            checked={s.isDefault}
            onChange={(e) => setS({ ...s, isDefault: e.target.checked })}
          />
        </Field>

        <Section>
          <SectionTitle>{t('profiles.editor.section.tls')}</SectionTitle>
          <Field label={t('profiles.editor.field.caPem')} htmlFor="profile-caPem">
            <TextArea id="profile-caPem" value={s.caPem} onChange={(e) => setS({ ...s, caPem: e.target.value })} />
          </Field>
          <Field label={t('profiles.editor.field.clientCertPem')} htmlFor="profile-clientCertPem">
            <TextArea id="profile-clientCertPem" value={s.clientCertPem} onChange={(e) => setS({ ...s, clientCertPem: e.target.value })} />
          </Field>
          <Field label={t('profiles.editor.field.clientKeyPem')} htmlFor="profile-clientKeyPem">
            <TextArea id="profile-clientKeyPem" value={s.clientKeyPem} onChange={(e) => setS({ ...s, clientKeyPem: e.target.value })} />
          </Field>
        </Section>

        <Section>
          <SectionTitle>{t('profiles.editor.section.pool')}</SectionTitle>
          <Row>
            <Field label={t('profiles.editor.field.maxOpenConns')} htmlFor="profile-maxOpenConns">
              <Number id="profile-maxOpenConns" value={s.maxOpenConns} onChange={(e) => setS({ ...s, maxOpenConns: e.target.value })} min={0} />
            </Field>
            <Field label={t('profiles.editor.field.maxIdleConns')} htmlFor="profile-maxIdleConns">
              <Number id="profile-maxIdleConns" value={s.maxIdleConns} onChange={(e) => setS({ ...s, maxIdleConns: e.target.value })} min={0} />
            </Field>
            <Field label={t('profiles.editor.field.connMaxLifetimeMs')} htmlFor="profile-connMaxLifetimeMs">
              <Number id="profile-connMaxLifetimeMs" value={s.connMaxLifetimeMs} onChange={(e) => setS({ ...s, connMaxLifetimeMs: e.target.value })} min={0} />
            </Field>
            <Field label={t('profiles.editor.field.connMaxIdleMs')} htmlFor="profile-connMaxIdleMs">
              <Number id="profile-connMaxIdleMs" value={s.connMaxIdleMs} onChange={(e) => setS({ ...s, connMaxIdleMs: e.target.value })} min={0} />
            </Field>
          </Row>
        </Section>

        <ButtonRow>
          <Button type="button" variant="ghost" onClick={onClose}>{t('profiles.editor.actions.cancel')}</Button>
          <Button type="submit" loading={busy}>{t('profiles.editor.actions.save')}</Button>
        </ButtonRow>
        {err && <ErrText role="alert">{err}</ErrText>}
      </form>
    </Modal>
  )
}
```

> Adjust the `Button variant="ghost"` or any other prop names to match the actual `Button` API in `src/components/ui/Button.tsx`. If `Number` styled `Input` doesn't accept `min`, just use a plain `<input type="number">` instead.

- [ ] **Step 5: Run test, expect PASS** — `npx jest src/components/profiles/ProfileEditorModal.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/components/profiles/ProfileEditorModal.tsx src/components/profiles/ProfileEditorModal.test.tsx src/services/i18n/locales/
git commit -m "feat(spa): ProfileEditorModal — create flow with TLS + pool tuning"
```

---

## Task 5: SPA — `ProfileEditorModal` edit flow (TDD)

**Files:** `src/components/profiles/ProfileEditorModal.tsx`, `src/components/profiles/ProfileEditorModal.test.tsx`, `src/services/i18n/locales/en.ts`

Extend the editor to also support `mode="edit"`: when the modal opens with a profile prop, populate the form, and on submit call `updateProfile(id, ...)` with the diff.

- [ ] **Step 1: Add i18n key**

```ts
'profiles.editor.edit.title': 'Edit profile',
```

- [ ] **Step 2: Append failing tests** to `ProfileEditorModal.test.tsx`:

```tsx
import { ProfileView } from '../../api/profiles'

const mockUpdate = jest.requireMock('../../api/profiles').updateProfile as jest.Mock

const editProfile: ProfileView = {
  id: 'p-existing',
  scope: 'personal',
  ownerUserId: 'alice',
  name: 'old',
  dsn: 'quic://old:1',
  description: 'old desc',
  isDefault: false,
  savedUsername: 'alice',
}

const renderEdit = (profile: ProfileView, onSaved: () => void) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>
        <ProfileEditorModal mode="edit" open onClose={jest.fn()} onSaved={onSaved} isAdmin={false} profile={profile} />
      </ThemeProvider>
    </I18nextProvider>
  )

test('edit — pre-populates fields from the supplied profile', async () => {
  renderEdit(editProfile, jest.fn())
  await waitFor(() => expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe('old'))
  expect((screen.getByLabelText(/^dsn$/i) as HTMLInputElement).value).toBe('quic://old:1')
})

test('edit — submit calls updateProfile with the typed input', async () => {
  mockUpdate.mockResolvedValueOnce({ ...editProfile, description: 'new desc' })
  const onSaved = jest.fn()
  renderEdit(editProfile, onSaved)
  fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'new desc' } })
  await act(async () => {
    fireEvent.submit(screen.getByLabelText(/name/i).closest('form')!)
    await Promise.resolve(); await Promise.resolve()
  })
  expect(mockUpdate).toHaveBeenCalledWith(
    'p-existing',
    expect.objectContaining({ description: 'new desc' })
  )
  expect(onSaved).toHaveBeenCalled()
})
```

Update the existing `jest.mock('../../api/profiles', ...)` block to also stub `updateProfile`:

```ts
jest.mock('../../api/profiles', () => ({
  ...jest.requireActual('../../api/profiles'),
  createProfile: jest.fn(),
  updateProfile: jest.fn(),
}))
```

- [ ] **Step 3: Run failing tests** — both edit tests fail because `mode === 'edit'` returns `null`.

- [ ] **Step 4: Wire the edit branch**

In `ProfileEditorModal.tsx`:

1. When `mode === 'edit'` and `profile` is set, initialise `s` with the profile's current values via `useEffect` on mount/profile-change.
2. Render the same form (just change the title to `profiles.editor.edit.title`).
3. Submit calls `updateProfile(profile.id, buildUpdateInput(s, profile))` instead of `createProfile`.

Add a helper `buildUpdateInput` that diffs the current form state against the original profile and only includes changed fields:

```ts
function buildUpdateInput(s: FormState, original: ProfileView): UpdateProfileInput {
  const out: UpdateProfileInput = {}
  if (s.name !== original.name) out.name = s.name
  if (s.dsn !== (original.dsn ?? '')) out.dsn = s.dsn
  if (s.description !== (original.description ?? '')) out.description = s.description
  if (s.savedUsername !== (original.savedUsername ?? '')) out.savedUsername = s.savedUsername
  if (s.isDefault !== original.isDefault) out.isDefault = s.isDefault
  // For TLS / pool overrides, send the full sub-struct if any of its
  // fields differ. Simpler than a per-field diff — small payload, no
  // wire-format ambiguity.
  const tlsChanged =
    s.caPem !== (original.tls?.caPem ?? '') ||
    s.clientCertPem !== (original.tls?.clientCertPem ?? '') ||
    s.clientKeyPem !== (original.tls?.clientKeyPem ?? '')
  if (tlsChanged) {
    out.tls = {
      caPem: s.caPem || undefined,
      clientCertPem: s.clientCertPem || undefined,
      clientKeyPem: s.clientKeyPem || undefined,
    }
  }
  const poChanged =
    s.maxOpenConns !== String(original.poolOverrides?.maxOpenConns ?? '') ||
    s.maxIdleConns !== String(original.poolOverrides?.maxIdleConns ?? '') ||
    s.connMaxLifetimeMs !== String(original.poolOverrides?.connMaxLifetimeMs ?? '') ||
    s.connMaxIdleMs !== String(original.poolOverrides?.connMaxIdleMs ?? '')
  if (poChanged) {
    const numOrUndef = (v: string) => (v === '' ? undefined : Number(v))
    out.poolOverrides = {
      maxOpenConns: numOrUndef(s.maxOpenConns),
      maxIdleConns: numOrUndef(s.maxIdleConns),
      connMaxLifetimeMs: numOrUndef(s.connMaxLifetimeMs),
      connMaxIdleMs: numOrUndef(s.connMaxIdleMs),
    }
  }
  return out
}
```

Replace the `if (mode === 'edit') return null` stub with the full form path. Use `useEffect` to populate the form state from the profile prop when it changes.

The Scope select should be DISABLED in edit mode (Plan A's `ErrImmutable`). The OwnerUserID is also immutable, but the form doesn't expose it — it's set automatically from the actor on create. No change needed there.

- [ ] **Step 5: Run all editor tests, expect PASS** — `npx jest src/components/profiles/ProfileEditorModal.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/components/profiles/ProfileEditorModal.tsx src/components/profiles/ProfileEditorModal.test.tsx src/services/i18n/locales/
git commit -m "feat(spa): ProfileEditorModal — edit flow with diff-only PATCH"
```

---

## Task 6: SPA — `DeleteProfileModal` (TDD)

**Files:** `src/components/profiles/DeleteProfileModal.tsx` (new), `src/components/profiles/DeleteProfileModal.test.tsx` (new), `src/services/i18n/locales/en.ts`

A small confirmation modal: "Delete profile <name>? This cannot be undone." → Confirm → calls `deleteProfile(id)` → onDeleted.

- [ ] **Step 1: Add i18n keys**

```ts
'profiles.delete.title': 'Delete profile',
'profiles.delete.confirm': 'Delete profile "{{name}}"? This cannot be undone.',
'profiles.delete.actions.delete': 'Delete',
'profiles.delete.actions.cancel': 'Cancel',
```

- [ ] **Step 2: Write the failing test**

```tsx
test('delete — clicking confirm calls deleteProfile and onDeleted', async () => {
  const onClose = jest.fn()
  const onDeleted = jest.fn()
  mockDelete.mockResolvedValueOnce(undefined)
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>
        <DeleteProfileModal open onClose={onClose} onDeleted={onDeleted} profile={editProfile} />
      </ThemeProvider>
    </I18nextProvider>
  )
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await Promise.resolve(); await Promise.resolve()
  })
  expect(mockDelete).toHaveBeenCalledWith('p-existing')
  expect(onDeleted).toHaveBeenCalled()
  expect(onClose).toHaveBeenCalled()
})
```

(Update the `jest.mock('../../api/profiles', ...)` block in this test file to also expose `deleteProfile`.)

- [ ] **Step 3: Implement `DeleteProfileModal.tsx`**

```tsx
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Modal } from '../ui'
import { deleteProfile, ProfileView } from '../../api/profiles'

export interface Props {
  open: boolean
  onClose: () => void
  onDeleted: () => void
  profile: ProfileView
}

export const DeleteProfileModal: React.FC<Props> = ({ open, onClose, onDeleted, profile }) => {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const onConfirm = async () => {
    setBusy(true); setErr(null)
    try {
      await deleteProfile(profile.id)
      onDeleted()
      onClose()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('profiles.delete.title')}>
      <p>{t('profiles.delete.confirm', { name: profile.name })}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('profiles.delete.actions.cancel')}
        </Button>
        <Button type="button" variant="danger" loading={busy} onClick={onConfirm}>
          {t('profiles.delete.actions.delete')}
        </Button>
      </div>
      {err && <p role="alert">{err}</p>}
    </Modal>
  )
}
```

(Adapt `Button variant` props to match the actual Button API. If `variant="danger"` doesn't exist, omit and add a styled-component wrapper that gives the delete button a red background.)

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/components/profiles/DeleteProfileModal.tsx src/components/profiles/DeleteProfileModal.test.tsx src/services/i18n/locales/
git commit -m "feat(spa): DeleteProfileModal confirmation dialog"
```

---

## Task 7: SPA — Wire editor + delete + create button into `ProfilesPage`

**Files:** `src/pages/ProfilesPage.tsx`, `src/pages/ProfilesPage.test.tsx`

Now connect the page list to the editor + delete modals + a "+ Create profile" button. Per-row action buttons: Edit, Delete, Set Default. Visible based on role/ownership.

- [ ] **Step 1: Append role-aware tests** to `ProfilesPage.test.tsx`:

```tsx
test('role admin: shows Edit + Delete on every row', async () => {
  // Render with a useAuth mock that returns admin role; assert
  // that every row has the action buttons.
})

test('non-admin user: only shows Edit + Delete on their own personal profiles', async () => {
  // ... role = "user", actor = "alice"; system profiles read-only;
  // alice's personal profiles editable; bob's personal profiles
  // shouldn't appear at all (server-side filtering).
})

test('clicking Edit opens the editor pre-populated', async () => {
  // ... mock listProfiles to return a profile, click Edit, assert
  // ProfileEditorModal renders with the profile values.
})
```

(Mock `useActor`/`useAuth` to control isAdmin + actor.Subject. The component reads its role-info from `useAuth()` — wire accordingly.)

- [ ] **Step 2: Update `ProfilesPage.tsx`**

Add state for the editor + delete modals:

```tsx
const [editorOpen, setEditorOpen] = useState(false)
const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create')
const [editorProfile, setEditorProfile] = useState<ProfileView | undefined>(undefined)
const [deleteTarget, setDeleteTarget] = useState<ProfileView | null>(null)

// ... and a useAuth() to determine isAdmin + the actor's subject.
const { isAuthed, /* possibly more */ } = useAuth()
// Read isAdmin via a helper or via a separate role hook. If the SPA
// has no client-side role state, we infer "admin" from whether system
// profiles include DSN data (which the server only returns to admins).
// For Plan D's simple form: assume isAdmin=false unless every system
// profile in the list has a non-empty DSN.
```

> If the SPA doesn't currently expose roles client-side, infer admin from the redaction state of the server response: when `getProfiles` returns system profiles WITH dsn populated, the caller is an admin. Plan A's `toGenProfile` only reveals DSN when `isAdmin || ownerMatches`. Compute:
>
> ```ts
> const isAdmin = profiles?.some((p) => p.scope === 'system' && !!p.dsn) ?? false
> ```
>
> This is a heuristic but it's correct for v0. If you have an existing isAdmin signal, prefer that.

Add a `+ Create profile` button in the header that opens the editor in create mode. Per-row Edit + Delete buttons that set state and open the modals.

For "Set as default" per row: button visible when the row is NOT default; clicking PATCHes the previous default to `is_default: false`, then PATCHes this row to `is_default: true`, then `refresh()`. Two sequential PATCHes; the v0 acceptance criterion is "at most one default per scope+owner; brief inconsistency window during the swap is acceptable."

- [ ] **Step 3: Run test, expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/pages/ProfilesPage.tsx src/pages/ProfilesPage.test.tsx
git commit -m "feat(spa): ProfilesPage wires create/edit/delete/setDefault flows"
```

---

## Task 8: SPA — Routing + nav link + saved-username pre-fill

**Files:** `src/App.tsx`, `src/components/layout/Shell.tsx`, `src/components/layout/AddConnectionModal.tsx`, `src/services/i18n/locales/en.ts`

- [ ] **Step 1: Add the route**

In `src/App.tsx`, add `/profiles` inside the `<ProtectedRoute>` block:

```tsx
import { ProfilesPage } from './pages/ProfilesPage'
// ...
<Route path="/profiles" element={<ProfilesPage />} />
```

- [ ] **Step 2: Add nav link in `Shell.tsx`**

Add a Profiles link to the existing nav block. Look at how the other links (Query, Schema, Admin, Ops) are rendered and follow the pattern.

- [ ] **Step 3: Saved-username pre-fill in `AddConnectionModal`**

The modal currently uses `fetchPublicProfiles` (system-only, no saved_username). Extend it to ALSO fetch the full profile list when the user is authed, and pre-fill the username field when the selected profile has `saved_username`.

```ts
import { listProfiles, ProfileView } from '../../api/profiles'

// Inside the component, after the existing useEffect that loads
// public profiles:
const [authedProfiles, setAuthedProfiles] = useState<ProfileView[]>([])
useEffect(() => {
  if (!open) return undefined
  let cancelled = false
  listProfiles()
    .then((list) => { if (!cancelled) setAuthedProfiles(list) })
    .catch(() => undefined)
  return () => { cancelled = true }
}, [open])

// When the profile select changes, look up saved_username and pre-fill.
useEffect(() => {
  const found = authedProfiles.find((p) => p.name === profile)
  if (found?.savedUsername) setUsername(found.savedUsername)
}, [profile, authedProfiles])
```

(Adapt to the actual existing component structure.)

- [ ] **Step 4: Add nav i18n key**

```ts
'nav.profiles': 'Profiles',
```

- [ ] **Step 5: Run the full SPA suite**

```bash
npx jest 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/layout/Shell.tsx src/components/layout/AddConnectionModal.tsx src/services/i18n/locales/
git commit -m "feat(spa): /profiles route + nav link + saved-username pre-fill"
```

---

## Task 9: End-to-end smoke + tag

**Files:** none

Build the production bundles, boot the server with a seed profile store, walk through the editor in a browser. Without a real Geode upstream, the actual login still won't work — the smoke verifies the production-built UI loads, the route is reachable, and the genapi-emitted CRUD endpoints respond appropriately for an authenticated request.

- [ ] **Step 1: Build**

```bash
make build
npx webpack --config webpack.prod.js 2>&1 | tail -3
```

- [ ] **Step 2: Boot**

```bash
TMPDIR=$(mktemp -d)
PROFILES="$TMPDIR/profiles.json"
STORE="$TMPDIR/profiles.db"
SECRET_HEX=$(openssl rand -hex 32)
PORT=18094
cat > "$PROFILES" <<'EOF'
[{"name":"prod","dsn":"quic://127.0.0.1:3141","description":"Production"}]
EOF
./bin/geode-ui \
  -profiles "$PROFILES" -profile-store "$STORE" \
  -jwt-secret-hex "$SECRET_HEX" -admin-users geode \
  -listen ":$PORT" -secure-cookies=false &
SERVER_PID=$!
sleep 1
```

- [ ] **Step 3: Mint a token + create a profile via the API**

```bash
TOKEN=$(scripts/run-go.sh run -tags smoke ./cmd/mint-token-smoke -secret-hex "$SECRET_HEX" -sub geode -profile prod -cid smoke-D)

curl -s -X POST "http://localhost:$PORT/api/v1/profiles" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"scope":"personal","name":"my-dev","dsn":"quic://127.0.0.1:3142","description":"D smoke"}' | jq .

curl -s "http://localhost:$PORT/api/v1/profiles" \
  -H "Authorization: Bearer $TOKEN" | jq '.profiles | length'
```

Expected: the POST returns the new profile JSON (with `id`, `owner_user_id: "geode"`); the list returns ≥2 profiles (the seeded `prod` system + the new `my-dev` personal).

- [ ] **Step 4: Update one profile**

```bash
ID=$(curl -s "http://localhost:$PORT/api/v1/profiles" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.profiles[] | select(.name == "my-dev") | .id')

curl -s -X PATCH "http://localhost:$PORT/api/v1/profiles/$ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"description":"updated by D smoke"}' | jq .description
```

Expected: `"updated by D smoke"`.

- [ ] **Step 5: Delete it**

```bash
HTTP=$(curl -s -X DELETE "http://localhost:$PORT/api/v1/profiles/$ID" \
  -H "Authorization: Bearer $TOKEN" -o /dev/null -w "%{http_code}")
echo "delete status: $HTTP"
```

Expected: 200/204.

- [ ] **Step 6: Cleanup**

```bash
kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null
rm -rf "$TMPDIR"
```

- [ ] **Step 7: Final test-suite check**

```bash
scripts/run-go.sh test ./...
npx jest 2>&1 | tail -5
```

Both must be clean.

- [ ] **Step 8: Tag**

```bash
git tag -a v0.5.0-plan-D-profile-editor -m "Plan D: ProfilesPage + ProfileEditorModal + DeleteProfileModal

Full SPA CRUD over Plan A's server-side endpoints. ProfilesPage
lists visible profiles with role-aware actions. ProfileEditorModal
covers create + edit (TLS PEM textareas, pool tuning numerics,
default flag, saved username). DeleteProfileModal handles delete
with confirmation. Default-flag UX enforces single-default-per-
scope SPA-side via two sequential PATCHes. Server-side: dropped
sticky-true on Default in mergeProfile so PATCH can clear it.

Plans A+B+C+D complete; Plan E adds Electron native polish."
```

Do NOT push.

---

## Self-review checklist

- [x] **Spec coverage:** ProfilesPage list, create flow, edit flow, delete flow, default-flag UX, server-side mergeProfile fix, route + nav, saved-username pre-fill.
- [x] **No placeholders:** every step has concrete code or exact commands.
- [x] **TDD discipline:** server change (Task 1), `profiles.ts` (Task 2), ProfilesPage (Task 3), editor create+edit (Tasks 4+5), delete (Task 6), wiring (Task 7) all start with failing tests.
- [x] **Type consistency:** `ProfileView`, `CreateProfileInput`, `UpdateProfileInput`, `TLSMaterial`, `PoolOverrides` referenced consistently across api + components.
- [x] **Frequent commits:** 9 tasks → 9 commits + 1 tag.

## Out of scope (deferred)

- **Per-connection-id logout endpoint** — needs server-side JWT revocation (SEC-N2)
- **TLS file-pick (Electron)** — Plan E
- **Token persistence in safeStorage** — Plan E
- **Auto-restore of connections on launch** — Plan E
- **Per-profile audit log** — useful but not blocking
- **Bulk import/export of profiles** — power-user feature; defer

---

## Execution Handoff

Plan D saved to `docs/superpowers/plans/2026-05-09-profile-system-rebuild-D-profile-editor.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — same pattern that shipped Plans A-C.
2. **Inline Execution** — `superpowers:executing-plans` with batched checkpoints.

When ready, ask for **Plan E (Electron native polish)** to be drafted next.
