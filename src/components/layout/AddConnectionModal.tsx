import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthProvider'
import { fetchPublicProfiles, PublicProfile } from '../../api/auth'
import { listProfiles, ProfileView } from '../../api/profiles'
import { Button, Field, Input, Modal } from '../ui'
import { getStoredPassword, isElectron } from '../../api/electron-bridge'

export interface Props {
  open: boolean
  onClose: () => void
}

// PSR-F14 (#111) — debounce window for the (gated) saved-password
// lookup. 300ms feels instant to a human typist but lets a 5-keystroke
// burst collapse to a single IPC + safeStorage decrypt.
const SAVED_PASSWORD_DEBOUNCE_MS = 300

function pwCacheKey(profile: string, username: string): string {
  // Mirrors the main-process `${profile}\x00${username}` key shape.
  return `${profile}\x00${username}`
}

export const AddConnectionModal: React.FC<Props> = ({ open, onClose }) => {
  const { t } = useTranslation()
  const { connectMore } = useAuth()
  const [profiles, setProfiles] = useState<PublicProfile[] | null>(null)
  const [profile, setProfile] = useState('default')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [savePw, setSavePw] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [authedProfiles, setAuthedProfiles] = useState<ProfileView[]>([])
  // PSR-F14 — explicit opt-in for the saved-password lookup. Pre-fix
  // every keystroke fired getStoredPassword whether or not the user
  // actually wanted to reuse a saved credential, paying the
  // safeStorage.decrypt cost on the modal's hot path.
  const [useSavedPw, setUseSavedPw] = useState(false)

  // Renderer-local cache for decrypted passwords keyed by
  // (profile, username). Cleared on close so the cache never outlives a
  // modal session — combined with PSR-F6's main-process memo this keeps
  // the cleartext cache lifetime bounded.
  const pwCacheRef = useRef<Map<string, string | null>>(new Map())
  // Debounce timer for the saved-password IPC. Replaced on every
  // username/profile change so the latest tuple always wins the race.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // PSR-F13 (#110): collapse the four open-time effects into a single
  // batched effect. fetchPublicProfiles + listProfiles are independent
  // network requests but share the modal-open lifecycle, so issuing
  // them via Promise.all lets us write both pieces of state in one
  // render cycle (and gives us a single cancellation seam).
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    Promise.all([
      fetchPublicProfiles().catch(() => [] as PublicProfile[]),
      listProfiles().catch(() => [] as ProfileView[]),
    ])
      .then(([publicList, authedList]) => {
        if (cancelled) return
        setProfiles(publicList)
        setAuthedProfiles(authedList)
        const first = publicList[0]
        if (first) setProfile(first.name)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open])

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
      getStoredPassword(profile, username)
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
  }, [open, useSavedPw, profile, username])

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
      await connectMore(username, password, profile, savePw)
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
