import React, { useEffect, useState } from 'react'
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

// ProfileDescription stays as a styled-component because the
// overflow-wrap:anywhere rule is load-bearing for the multi-sentence
// description copy inside the 380 px form card — replacing it with
// Bootstrap's `.text-break` is fine in theory but the typography
// (color: theme.text.secondary, theme-token font-size) keeps the
// component tied to theme tokens. Bootstrap's `.text-secondary` would
// shadow the wa-theme token under data-theme="dark"; keep it native.
const ProfileDescription = styled.div`
  font-size: ${({ theme }) => theme.font.sizes.sm};
  color: ${({ theme }) => theme.text.secondary};
  padding: 0 ${({ theme }) => theme.spacing.sm};
  overflow-wrap: anywhere;
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
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
    }
  }

  const showList = profiles && profiles.length > 0 && !loadErr

  return (
    <Form onSubmit={submit} className="p-4 d-flex flex-column gap-3">
      <div className="d-flex justify-content-center mb-3">
        <Logo height={36} variant="on-light" />
      </div>
      <Title>{t('auth.signIn')}</Title>

      {showList ? (
        <ul
          aria-label={t('auth.profileList')}
          className="list-unstyled m-0 p-0 d-flex flex-column gap-1"
        >
          {profiles!.map((p) => (
            <li key={p.name} className="d-flex flex-column gap-1">
              {/*
                Profile description must sit OUTSIDE the <wa-button>: the
                button's shadow-DOM label slot lays out children inline
                without word-wrap, so a multi-paragraph <div> slotted as
                a button child overflows the form card horizontally
                (~1051px wide inside a 380px form, regression caught by
                25-ui-health.spec.ts).
              */}
              <wa-button
                type="button"
                appearance={p.name === profile ? 'filled' : 'outlined'}
                variant={p.name === profile ? 'brand' : 'default'}
                size="m"
                role="button"
                data-testid={`login-profile-${p.name}`}
                aria-pressed={p.name === profile ? 'true' : 'false'}
                aria-label={p.name}
                aria-describedby={
                  p.description ? `login-profile-${p.name}-desc` : undefined
                }
                onClick={() => setProfile(p.name)}
                style={{ width: '100%' }}
              >
                <strong>{p.name}</strong>
              </wa-button>
              {p.description ? (
                <ProfileDescription id={`login-profile-${p.name}-desc`}>
                  {p.description}
                </ProfileDescription>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Field label={t('auth.profile')} htmlFor="login-profile">
          <WaInput
            id="login-profile"
            data-testid="login-profile-input"
            value={profile}
            onInput={(e) => setProfile((e.target as HTMLInputElement).value)}
          />
        </Field>
      )}

      <Field label={t('auth.username')} htmlFor="login-username" required>
        <WaInput
          id="login-username"
          type="text"
          data-testid="login-username"
          value={username}
          onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
          autoComplete="username"
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
      <wa-button
        type="submit"
        appearance="filled"
        variant="brand"
        size="m"
        role="button"
        data-testid="login-submit-btn"
        disabled={busy ? true : undefined}
        loading={busy ? true : undefined}
        onClick={submit}
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
  )
}
