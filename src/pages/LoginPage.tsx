import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import { Field } from '@geodedb/ui-core'
import { useAuth } from '../auth/AuthProvider'
import { GeodeLogo as Logo } from '../components/brand/GeodeLogo'
import {
  Input as WaInput,
  Checkbox as WaCheckbox,
} from '../services/webawesome/components'
import { isElectron } from '../api/electron-bridge'
import { usePublicProfilesWithStoredPasswords } from '../lib/usePublicProfilesWithStoredPasswords'
import { ProfileFilter } from '../components/auth/ProfileFilter'
import { OnboardProfileForm } from '../components/auth/OnboardProfileForm'

// Bootstrap-migrated styled-components — the Form, Title, ProfileList,
// ProfileDescription, ErrText, and LogoSlot below now lean on Bootstrap
// 5.3 utility classes for layout (d-flex, gap, mb-*, p-*) while the
// styled-component keeps the theme-token-driven surface, border, and
// typography concerns the utilities don't cover. Pattern documented at
// docs/BOOTSTRAP_MIGRATION.md.
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

export const LoginPage: React.FC = () => {
  const { signIn } = useAuth()
  const { t } = useTranslation()
  const nav = useNavigate()

  // GAP-021 / #102: the public-profiles fetch + the saved-password
  // lookup used to inline both effects here AND in
  // AddConnectionModal.tsx. They now live behind a shared hook
  // (`usePublicProfilesWithStoredPasswords`) so the cancellation
  // semantics + the single-state-update invariant (QUALITY #227) stay
  // identical across call sites.
  const { profilesState, lookupStoredPassword } =
    usePublicProfilesWithStoredPasswords()
  const { profiles, loadErr } = profilesState
  const [profile, setProfile] = useState<string>('default')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [savePw, setSavePw] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 2026-05-21 login profile UX (Task 7): three-way render branch.
  // Zero profiles → onboard form as the landing view; explicit toggle
  // from the login form → same form, returnable via onCancel. The
  // `profiles !== null` guard distinguishes "fetch resolved with an
  // empty list" (onboard mode is correct) from "fetch still in flight"
  // (initial state is null — render the login form skeleton; the
  // ProfileFilter will swap in once the list resolves).
  const [showOnboard, setShowOnboard] = useState<boolean>(false)
  const noProfiles =
    profilesState.profiles !== null &&
    profilesState.profiles.length === 0 &&
    !profilesState.loadErr

  // Apply the discovered default profile name in a separate effect so
  // the fetcher's single-state-update invariant stays clean. The effect
  // runs synchronously after the fetcher's setState commits, inside
  // the same React update boundary RTL's act() wraps.
  useEffect(() => {
    if (profilesState.initialProfileName) {
      setProfile(profilesState.initialProfileName)
    }
  }, [profilesState.initialProfileName])

  useEffect(() => {
    if (!username || !profile) return undefined
    let cancelled = false
    lookupStoredPassword(profile, username).then((pw) => {
      if (cancelled) return
      if (pw) setPassword(pw)
    })
    return () => {
      cancelled = true
    }
  }, [profile, username, lookupStoredPassword])

  // Read the live username + password values from the <wa-input> host
  // properties at submit time, falling back to React state. Chrome's
  // saved-password autofill writes to the shadow-DOM <input> directly
  // and only fires `change` (not `input`) on the inner element. WA's
  // wa-input host syncs its value property on either event, but the
  // React-controlled `value` prop here only updates on `onInput`, so
  // an autofilled password leaves `password` state empty and the form
  // POSTs an empty string — server then 400s with "password: too
  // short". Reading the host's current value at submit closes that
  // gap without forcing onChange + onInput convergence in the wrapper.
  // Caught by e2e/specs/26-login-edge-cases.spec.ts.
  const readWaInputValue = (id: string, fallback: string): string => {
    if (typeof document === 'undefined') return fallback
    const el = document.getElementById(id) as
      | (HTMLElement & { value?: string })
      | null
    const v = el?.value
    if (typeof v === 'string' && v.length > 0) return v
    return fallback
  }

  // Synchronous in-flight guard. The `busy` state setter is async — a
  // second submit fired in the same microtask tick (e.g. wa-button's
  // own form-submit bridge running in parallel with anything else
  // listening for the click) would otherwise see busy=false and
  // spawn a second signIn(). The ref dedupes without waiting for
  // React to commit the busy flip.
  const submitInflightRef = useRef(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitInflightRef.current) return
    submitInflightRef.current = true
    setBusy(true)
    setErr(null)
    const liveUsername = readWaInputValue('login-username', username)
    const livePassword = readWaInputValue('login-password', password)
    try {
      await signIn(liveUsername, livePassword, profile, savePw)
      nav('/', { replace: true })
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : t('auth.loginFailed'))
    } finally {
      setBusy(false)
      submitInflightRef.current = false
    }
  }

  // Onboard branch: zero profiles in the system OR the user explicitly
  // toggled to "add a new profile". The OnboardProfileForm POSTs to
  // /api/v1/profiles/onboard which validates the supplied admin creds
  // against the supplied DSN, persists a system-scope profile, and
  // mints a JWT (server writes the auth cookie). onSuccess navigates
  // to the protected shell; AuthProvider rehydrates session posture
  // from /api/v1/auth/whoami on next mount.
  if (showOnboard || noProfiles) {
    return (
      <OnboardProfileForm
        onSuccess={() => {
          nav('/', { replace: true })
        }}
        onCancel={() => setShowOnboard(false)}
      />
    )
  }

  return (
    <div className="d-flex flex-column align-items-center">
      <Form
        onSubmit={submit}
        className="p-4 d-flex flex-column gap-3"
        name="geode-login"
        // autoComplete="on" makes the host-level intent explicit for
        // password managers: this is a credential form, the fields
        // declare their semantic roles, please offer/fill saved logins
        // here. Pairs with the per-field autocomplete tokens below.
        autoComplete="on"
      >
        <div className="d-flex justify-content-center mb-3">
          <Logo height={36} variant="on-light" />
        </div>
        <Title>{t('auth.signIn')}</Title>

        {profiles && profiles.length > 0 && !loadErr ? (
          <ProfileFilter
            profiles={profiles}
            value={profile}
            onChange={setProfile}
          />
        ) : null}

        <Field label={t('auth.username')} htmlFor="login-username" required>
          <WaInput
            id="login-username"
            type="text"
            data-testid="login-username"
            value={username}
            onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
            autoComplete="username"
            name="username"
            required
          />
        </Field>
        <Field label={t('auth.password')} htmlFor="login-password" required>
          <WaInput
            id="login-password"
            type="password"
            data-testid="login-password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            autoComplete="current-password"
            name="password"
            required
          />
        </Field>
        {isElectron() ? (
          <Field label={t('auth.savePassword')} htmlFor="login-savePw">
            <WaCheckbox
              id="login-savePw"
              data-testid="login-save-password"
              checked={savePw}
              onChange={(e: Event) => {
                const target = e.target as HTMLInputElement
                setSavePw(target.checked)
              }}
              size="m"
            />
          </Field>
        ) : null}
        {/*
          NATIVE submit anchor for password managers + Enter-key
          submission. 1Password / Bitwarden / LastPass scan the form
          for a real `button[type="submit"]` to click after autofill;
          `<wa-button>` is a custom element they don't recognize. This
          hidden native button is the first submit-typed element in
          the form, so it becomes the implicit submit target for
          form.requestSubmit() and password-manager auto-submit, and
          forwards the gesture through the form's onSubmit handler
          (same `submit` callback the visible wa-button wires to).
          aria-hidden + tabIndex=-1 keep it off the a11y tree and tab
          order; `display:none` would disqualify it as an implicit
          submit target in some browsers, so we visually hide it
          instead. See e2e/specs/40-login-password-manager.spec.ts +
          src/pages/LoginPage.passwordManager.test.tsx for the
          regression invariants this anchor satisfies.
        */}
        <button
          type="submit"
          aria-hidden="true"
          tabIndex={-1}
          data-testid="login-submit-anchor"
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: 'hidden',
            clip: 'rect(0,0,0,0)',
            whiteSpace: 'nowrap',
            border: 0,
          }}
        >
          {t('auth.signInButton')}
        </button>
        {/*
          NO onClick={submit} on the wa-button. The wa-button is
          form-associated via ElementInternals: clicking it programmatically
          appends a temporary native <button type="submit"> to the
          form, clicks that, and removes it — see
          node_modules/@awesome.me/webawesome/dist/chunks/chunk.LAD5TI7P.js
          handleClick. The form's `onSubmit={submit}` catches that
          submit event, so wiring onClick={submit} here would just
          double-fire signIn() per user click. The submitInflightRef
          guard above dedupes regardless; this comment is here so
          future refactors don't re-add the onClick "for safety."
        */}
        <wa-button
          type="submit"
          appearance="filled"
          variant="brand"
          size="m"
          role="button"
          data-testid="login-submit-btn"
          disabled={busy ? true : undefined}
          loading={busy ? true : undefined}
          style={{ width: '100%' }}
        >
          {t('auth.signInButton')}
        </wa-button>
        {err && (
          <p role="alert" className="text-danger small m-0">
            {err}
          </p>
        )}
      </Form>
      {/*
        2026-05-22 password-manager safety: the "+ Add a new profile"
        toggle lives OUTSIDE the <form> so 1Password's "click the
        first/only native button in the form after autofill"
        heuristic can never land on it. It's still rendered
        immediately below the login card visually, but it's a sibling
        of the form, not a descendant. Pre-fix it was rendered as the
        last child of the form and was the only native <button> there
        — password-manager auto-submit clicked it and silently
        swapped the page into OnboardProfileForm. See
        e2e/specs/40-login-password-manager.spec.ts.
      */}
      <button
        type="button"
        className="btn btn-link btn-sm p-0 mt-2"
        data-testid="login-add-profile"
        onClick={() => setShowOnboard(true)}
      >
        {t('auth.loginAddProfile')}
      </button>
    </div>
  )
}
