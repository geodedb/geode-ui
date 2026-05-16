/**
 * usePublicProfilesWithStoredPasswords -- shared effect that powers
 * the LoginPage and the AddConnectionModal's "pick a profile, fill
 * the saved password" UX.
 *
 * GAP-021 / #102: both call sites (`src/pages/LoginPage.tsx` and
 * `src/components/layout/AddConnectionModal.tsx`) used to inline the
 * same two-effect dance:
 *
 *   1. fetchPublicProfiles() on mount (or modal-open), cancel on
 *      unmount, default the active profile to the first entry.
 *   2. getStoredPassword(profile, username) when those change, cancel
 *      on unmount, write the cleartext into the password state when
 *      one is found.
 *
 * The duplication was caught by the docs/GAP_ANALYSIS.md audit. This
 * hook consolidates the public-profiles half (with a clean
 * cancellation seam and a single state-update path so the caller's
 * tests can wrap state writes in one act()), and returns a
 * `lookupStoredPassword` callback that the caller invokes when it's
 * appropriate to attempt password recovery. Each call site retains
 * its own debounce / cache decisions: AddConnectionModal still gates
 * the lookup on `useSavedPw` + a 300 ms debounce + a renderer-local
 * (profile,username) cache; LoginPage runs the lookup every time the
 * effective tuple changes.
 *
 * The hook deliberately does NOT inline the saved-password fetch
 * into the profiles effect -- that would force every caller to share
 * the gating semantics. Returning the loader as a function lets each
 * caller wrap it in the policy that matches their UX (modal gating,
 * login auto-fill, etc.).
 *
 * The `enabled` option lets the AddConnectionModal gate the
 * profiles fetch on `open`, while LoginPage (always-on mount) leaves
 * it at the default `true`.
 */
import { useCallback, useEffect, useState } from 'react'

import { fetchPublicProfiles, type PublicProfile } from '../api/auth'
import { getStoredPassword } from '../api/electron-bridge'

/**
 * Single state slot for the public-profile fetch so the hook commits
 * exactly one setState per outcome (success OR failure). The
 * LoginPage call site originally fired two/three setStates back to
 * back outside an act() boundary, producing the documented `act(...)`
 * warning -- the consolidated slot preserves that fix.
 */
export interface PublicProfilesState {
  /** null until the fetch resolves or fails. */
  profiles: PublicProfile[] | null
  /** true after a failed fetch; reset to false on the next success. */
  loadErr: boolean
  /** the first profile name from the fetch, or null on empty/failed. */
  initialProfileName: string | null
}

const INITIAL_STATE: PublicProfilesState = {
  profiles: null,
  loadErr: false,
  initialProfileName: null,
}

export interface UsePublicProfilesWithStoredPasswordsOptions {
  /**
   * When false the hook skips the profiles fetch entirely (used by
   * the AddConnectionModal which gates the fetch on `open`). Defaults
   * to true so the LoginPage / mount-time caller doesn't have to
   * thread the option.
   */
  enabled?: boolean
}

export interface UsePublicProfilesWithStoredPasswordsResult {
  /** Aggregate fetch state. Read by the picker render path. */
  profilesState: PublicProfilesState
  /**
   * Fire the stored-password lookup for the given (profile, username)
   * tuple. Resolves to the cleartext password (string) when one was
   * stored, null when none, or rejects on IPC error.
   *
   * The function captures no internal cancellation seam -- callers
   * own the cancellation contract because they already own the
   * debounce / cache decisions. Use a `cancelled` boolean closed over
   * by the caller's effect and check it after the promise resolves.
   */
  lookupStoredPassword: (
    profile: string,
    username: string
  ) => Promise<string | null>
  /**
   * Reset the profiles state to the initial (null/null/null) shape.
   * Used by AddConnectionModal between opens so a previous failure
   * doesn't bleed across modal sessions.
   */
  resetProfilesState: () => void
}

export function usePublicProfilesWithStoredPasswords(
  options: UsePublicProfilesWithStoredPasswordsOptions = {}
): UsePublicProfilesWithStoredPasswordsResult {
  const { enabled = true } = options
  const [profilesState, setProfilesState] =
    useState<PublicProfilesState>(INITIAL_STATE)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    fetchPublicProfiles()
      .then((list) => {
        if (cancelled) return
        const initial = list.length > 0 && list[0] ? list[0].name : null
        setProfilesState({
          profiles: list,
          loadErr: false,
          initialProfileName: initial,
        })
      })
      .catch(() => {
        if (cancelled) return
        setProfilesState({
          profiles: null,
          loadErr: true,
          initialProfileName: null,
        })
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  // Pass-through to the electron-bridge so call sites don't have to
  // import getStoredPassword themselves. Wrapped in useCallback so
  // the function identity is stable across renders -- callers that
  // list it in a useEffect deps array won't trigger spurious re-runs.
  const lookupStoredPassword = useCallback(
    async (profile: string, username: string): Promise<string | null> => {
      return getStoredPassword(profile, username)
    },
    []
  )

  // Same identity-stability concern as lookupStoredPassword. The
  // AddConnectionModal calls this inside an effect that depends on
  // `open`; if resetProfilesState's identity flipped each render the
  // effect would re-fire (and re-issue listProfiles) on every render.
  const resetProfilesState = useCallback(
    (): void => setProfilesState(INITIAL_STATE),
    []
  )

  return { profilesState, lookupStoredPassword, resetProfilesState }
}
