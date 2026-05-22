import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Field, Input, Modal } from '@geodedb/ui-core'
import { useAuth } from '../../auth/AuthProvider'
import { listProfiles, ProfileView } from '../../api/profiles'
import { isElectron } from '../../api/electron-bridge'
import { usePublicProfilesWithStoredPasswords } from '../../lib/usePublicProfilesWithStoredPasswords'

export interface Props {
  open: boolean
  onClose: () => void
  // 2026-05-21 bug-fix: the post-Create flow on /profiles opens this
  // modal pre-selected to the just-created profile so the user goes
  // straight from "I made a profile target" to "now log in as me".
  // When unset (the existing chrome-driven flow) the modal falls back
  // to the public-profiles default discovery (initialProfileName from
  // usePublicProfilesWithStoredPasswords).
  initialProfile?: string
}

// PSR-F14 (#111) — debounce window for the (gated) saved-password
// lookup. 300ms feels instant to a human typist but lets a 5-keystroke
// burst collapse to a single IPC + safeStorage decrypt.
const SAVED_PASSWORD_DEBOUNCE_MS = 300

function pwCacheKey(profile: string, username: string): string {
  // Mirrors the main-process `${profile}\x00${username}` key shape.
  return `${profile}\x00${username}`
}

export const AddConnectionModal: React.FC<Props> = ({
  open,
  onClose,
  initialProfile,
}) => {
  const { t } = useTranslation()
  const { connectMore, switchActive } = useAuth()
  // GAP-021 / #102: the public-profiles fetch + the saved-password
  // lookup now live behind a shared hook (LoginPage uses the same
  // hook). The hook's `enabled: open` knob preserves the modal-open
  // gating that PSR-F13 introduced; the cancellation seam is owned
  // by the hook so the modal no longer threads its own cancelled
  // boolean for that fetch.
  const { profilesState, lookupStoredPassword, resetProfilesState } =
    usePublicProfilesWithStoredPasswords({ enabled: open })
  const profiles = profilesState.profiles
  const publicProfilesErr = profilesState.loadErr
  const [profile, setProfile] = useState('default')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [savePw, setSavePw] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [authedProfiles, setAuthedProfiles] = useState<ProfileView[]>([])
  // PSR-G04 (#81) / PSR-G10 (#87): the open-time effect previously
  // swallowed errors from listProfiles, so a failed bootstrap left
  // the user with no feedback (the saved-username dropdown silently
  // disappeared). This flag surfaces the failure independently so the
  // form stays usable while telling the user what degraded. The
  // public-profiles equivalent now lives in `profilesState.loadErr`
  // returned by the shared hook.
  const [authedProfilesErr, setAuthedProfilesErr] = useState(false)
  // PSR-F14 — explicit opt-in for the saved-password lookup. Pre-fix
  // every keystroke fired getStoredPassword whether or not the user
  // actually wanted to reuse a saved credential, paying the
  // safeStorage.decrypt cost on the modal's hot path.
  const [useSavedPw, setUseSavedPw] = useState(false)

  // Apply the discovered default profile name in a separate effect so
  // the public-profiles fetcher's single-state-update invariant stays
  // clean (matches LoginPage's pattern). 2026-05-22 fix: skip the
  // assignment when the caller supplied `initialProfile` — the
  // public-profiles fetch resolves AFTER the modal opens and would
  // otherwise overwrite the prop-applied profile (the operator's
  // explicit pick from the ConnectionSwitcher dropdown). Pinned by
  // AddConnectionModal.test.tsx#initialProfile-precedence-over-public-profiles-default.
  useEffect(() => {
    if (initialProfile) return
    if (profilesState.initialProfileName) {
      setProfile(profilesState.initialProfileName)
    }
  }, [profilesState.initialProfileName, initialProfile])

  // 2026-05-21 bug-fix: if the caller supplied `initialProfile` (the
  // post-Create flow on /profiles, OR the 2026-05-22 ConnectionSwitcher
  // "click an inactive profile" flow), it wins over the public-profiles
  // discovery. This effect runs on every modal open so re-opening the
  // modal with a different prop value re-selects the new profile.
  useEffect(() => {
    if (open && initialProfile) {
      setProfile(initialProfile)
    }
  }, [open, initialProfile])

  // Renderer-local cache for decrypted passwords keyed by
  // (profile, username). Cleared on close so the cache never outlives a
  // modal session — combined with PSR-F6's main-process memo this keeps
  // the cleartext cache lifetime bounded.
  const pwCacheRef = useRef<Map<string, string | null>>(new Map())
  // Debounce timer for the saved-password IPC. Replaced on every
  // username/profile change so the latest tuple always wins the race.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // listProfiles still runs in its own open-gated effect: it's an
  // independent network request from the shared hook's public-profile
  // fetch (different endpoint, different auth requirement) and the
  // authed-profile dropdown is modal-only. Cancellation is local to
  // this effect.
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setAuthedProfilesErr(false)
    resetProfilesState()
    listProfiles()
      .then((list) => {
        if (cancelled) return
        setAuthedProfiles(list)
      })
      .catch(() => {
        if (cancelled) return
        setAuthedProfiles([])
        setAuthedProfilesErr(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, resetProfilesState])

  // Saved-username sync stays as a pure state-derivation effect — it
  // never triggers IPC, so it doesn't share the F14 debounce concern.
  useEffect(() => {
    const found = authedProfiles.find((p) => p.name === profile)
    if (found?.savedUsername) {
      setUsername(found.savedUsername)
    }
  }, [profile, authedProfiles])

  // PSR-F14: gated, debounced, cached saved-password lookup.
  //
  // - Toggle OFF → no IPC, ever. The user explicitly opts in.
  // - Toggle ON  → wait 300ms after the last (profile, username)
  //   change before firing. A burst of keystrokes collapses to one
  //   IPC. PSR-F6's main-process memo keeps even un-debounced lookups
  //   cheap, but the renderer-side debounce is defense-in-depth and
  //   avoids modal-internal flicker on partial usernames.
  // - Cache hit → reuse the previously decrypted password without
  //   another IPC. The cache lives only as long as the modal is open.
  useEffect(() => {
    if (!open) return undefined
    if (!useSavedPw) return undefined
    if (!username || !profile) return undefined

    // Cache hit: short-circuit without touching IPC or the timer.
    const key = pwCacheKey(profile, username)
    const cached = pwCacheRef.current.get(key)
    if (cached !== undefined) {
      if (cached) setPassword(cached)
      return undefined
    }

    let cancelled = false
    debounceRef.current = setTimeout(() => {
      lookupStoredPassword(profile, username)
        .then((pw) => {
          if (cancelled) return
          // Cache the result (including null) so a subsequent re-type
          // of the same tuple is a synchronous hit.
          pwCacheRef.current.set(key, pw)
          if (pw) setPassword(pw)
        })
        .catch(() => undefined)
    }, SAVED_PASSWORD_DEBOUNCE_MS)

    return () => {
      cancelled = true
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [open, useSavedPw, profile, username, lookupStoredPassword])

  // PSR-F14: reset the modal's secret-bearing state when the user
  // closes it. The password cache and the useSavedPw toggle both leak
  // intent across modal sessions if they persist; clearing them here
  // guarantees a freshly opened modal starts from a known-empty
  // posture (consistent with the username field clearing in `submit`).
  useEffect(() => {
    if (!open) {
      pwCacheRef.current.clear()
      setUseSavedPw(false)
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [open])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const newConnectionId = await connectMore(
        username,
        password,
        profile,
        savePw
      )
      // 2026-05-22 bug-fix: when the modal opens with `initialProfile`
      // the operator picked a SPECIFIC profile to use (either the
      // ConnectionSwitcher's "click an inactive profile" affordance
      // or the /profiles "Create → connect" flow). Both flows want
      // the UI to switch focus to the freshly-connected profile;
      // connectMore by design does not setActive, so do it
      // explicitly here. The bare "+ Add another connection" flow
      // (no initialProfile prop) preserves the original add-without-
      // switching semantics — the operator can switch later via the
      // dropdown if they want to.
      if (initialProfile) {
        switchActive(newConnectionId)
      }
      onClose()
      setUsername('')
      setPassword('')
      pwCacheRef.current.clear()
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : t('auth.loginFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('connection.addAnother')}>
      <form onSubmit={submit}>
        {/*
          PSR-G04 (#81) — surface load failures from the open-time
          effect. The form is still usable when these fail (the profile
          field falls back to a free-form input via the `profiles &&
          profiles.length > 0` ternary below), so we render a non-
          blocking warning rather than a hard error block. role="status"
          + aria-live="polite" matches the LoginPage error pattern.
        */}
        {publicProfilesErr && (
          <p
            role="status"
            aria-live="polite"
            data-testid="add-connection-public-profile-warning"
          >
            {t('connection.publicProfileListLoadFailed')}
          </p>
        )}
        {authedProfilesErr && (
          <p
            role="status"
            aria-live="polite"
            data-testid="add-connection-authed-profile-warning"
          >
            {t('connection.profileListLoadFailed')}
          </p>
        )}
        {profiles && profiles.length > 0 ? (
          <Field label={t('auth.profile')} htmlFor="add-profile">
            <select
              id="add-profile"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.description ? `${p.name} — ${p.description}` : p.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label={t('auth.profile')} htmlFor="add-profile">
            <Input
              id="add-profile"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
            />
          </Field>
        )}
        <Field label={t('auth.username')} htmlFor="add-username" required>
          <Input
            id="add-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </Field>
        {isElectron() ? (
          <Field label={t('auth.useSavedPassword')} htmlFor="add-useSavedPw">
            <input
              id="add-useSavedPw"
              type="checkbox"
              checked={useSavedPw}
              onChange={(e) => setUseSavedPw(e.target.checked)}
            />
          </Field>
        ) : null}
        <Field label={t('auth.password')} htmlFor="add-password" required>
          <Input
            id="add-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        {isElectron() ? (
          <Field label={t('auth.savePassword')} htmlFor="add-savePw">
            <input
              id="add-savePw"
              type="checkbox"
              checked={savePw}
              onChange={(e) => setSavePw(e.target.checked)}
            />
          </Field>
        ) : null}
        <Button type="submit" loading={busy} fullWidth>
          {t('auth.signInButton')}
        </Button>
        {err && <p role="alert">{err}</p>}
      </form>
    </Modal>
  )
}
