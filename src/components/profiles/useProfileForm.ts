// useProfileForm — single source of truth for the ProfileEditorModal
// form state. Pre-refactor the modal carried a ~13-field FormState
// shape, four mirroring helpers (`empty`, `fromProfile`,
// `buildCreateInput`, `buildUpdateInput`), and inline `setS({...s,
// foo: e.target.value})` callbacks at every Field. The shape was
// duplicated FIVE times across the component (state init, reset,
// edit-mount populate, create build, update diff) and any new field
// required touching all five sites.
//
// GAP-Q05 (#95): this hook collapses those five sites into one
// FormState definition, one default-empty constant, one
// fromProfile, one create-builder, one update-diff-builder, and a
// setField(key, value) callback that the modal threads to every
// input. The modal becomes a thin presentational layer.
//
// Pure refactor: behaviour is preserved. `numOrUndef`,
// `buildCreateInput`, `buildUpdateInput`, and the edit-mount
// populate-on-prop-change all still match the prior implementation.

import { useCallback, useEffect, useState } from 'react'
import {
  CreateProfileInput,
  UpdateProfileInput,
  ProfileView,
  Scope,
} from '../../api/profiles'

export interface FormState {
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

export const emptyFormState: FormState = {
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

function numOrUndef(v: string): number | undefined {
  return v === '' ? undefined : Number(v)
}

export function fromProfile(p: ProfileView): FormState {
  return {
    scope: p.scope,
    name: p.name,
    dsn: p.dsn ?? '',
    description: p.description ?? '',
    savedUsername: p.savedUsername ?? '',
    isDefault: p.isDefault,
    caPem: p.tls?.caPem ?? '',
    clientCertPem: p.tls?.clientCertPem ?? '',
    clientKeyPem: p.tls?.clientKeyPem ?? '',
    maxOpenConns: p.poolOverrides?.maxOpenConns?.toString() ?? '',
    maxIdleConns: p.poolOverrides?.maxIdleConns?.toString() ?? '',
    connMaxLifetimeMs: p.poolOverrides?.connMaxLifetimeMs?.toString() ?? '',
    connMaxIdleMs: p.poolOverrides?.connMaxIdleMs?.toString() ?? '',
  }
}

export function buildCreateInput(s: FormState): CreateProfileInput {
  let tls: CreateProfileInput['tls']
  if (s.caPem || s.clientCertPem || s.clientKeyPem) {
    tls = {
      caPem: s.caPem || undefined,
      clientCertPem: s.clientCertPem || undefined,
      clientKeyPem: s.clientKeyPem || undefined,
    }
  }
  let poolOverrides: CreateProfileInput['poolOverrides']
  if (
    s.maxOpenConns ||
    s.maxIdleConns ||
    s.connMaxLifetimeMs ||
    s.connMaxIdleMs
  ) {
    poolOverrides = {
      maxOpenConns: numOrUndef(s.maxOpenConns),
      maxIdleConns: numOrUndef(s.maxIdleConns),
      connMaxLifetimeMs: numOrUndef(s.connMaxLifetimeMs),
      connMaxIdleMs: numOrUndef(s.connMaxIdleMs),
    }
  }
  return {
    scope: s.scope,
    name: s.name,
    dsn: s.dsn,
    description: s.description || undefined,
    savedUsername: s.savedUsername || undefined,
    isDefault: s.isDefault,
    tls,
    poolOverrides,
  }
}

export function buildUpdateInput(
  s: FormState,
  original: ProfileView
): UpdateProfileInput {
  const out: UpdateProfileInput = {}
  if (s.name !== original.name) {
    out.name = s.name
  }
  if (s.dsn !== (original.dsn ?? '')) {
    out.dsn = s.dsn
  }
  if (s.description !== (original.description ?? '')) {
    out.description = s.description
  }
  if (s.savedUsername !== (original.savedUsername ?? '')) {
    out.savedUsername = s.savedUsername
  }
  // is_default: only emit the key when the user actually toggled it.
  // The server's UpdateProfileReq now uses *bool (PSR-G02-followup
  // #124), so an absent key preserves the persisted Default value and
  // an explicit `false` clears it. Always echoing was a workaround
  // for the pre-pointer schema and would now silently overwrite the
  // persisted state on every unrelated PATCH.
  if (s.isDefault !== original.isDefault) {
    out.isDefault = s.isDefault
  }

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
    s.connMaxLifetimeMs !==
      String(original.poolOverrides?.connMaxLifetimeMs ?? '') ||
    s.connMaxIdleMs !== String(original.poolOverrides?.connMaxIdleMs ?? '')
  if (poChanged) {
    out.poolOverrides = {
      maxOpenConns: numOrUndef(s.maxOpenConns),
      maxIdleConns: numOrUndef(s.maxIdleConns),
      connMaxLifetimeMs: numOrUndef(s.connMaxLifetimeMs),
      connMaxIdleMs: numOrUndef(s.connMaxIdleMs),
    }
  }
  return out
}

export interface ProfileFormApi {
  state: FormState
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  buildCreateInput: () => CreateProfileInput
  buildUpdateInput: (original: ProfileView) => UpdateProfileInput
  reset: () => void
}

/**
 * useProfileForm — manages the FormState backing ProfileEditorModal.
 *
 * Pass a ProfileView to start in "edit" mode (form pre-populates from
 * the profile and re-syncs whenever the prop reference changes —
 * matches the pre-refactor `useEffect([mode, profile])` behaviour).
 * Omit it for "create" mode (form starts empty and `reset()` returns
 * to empty after a successful submit).
 */
export function useProfileForm(initial?: ProfileView): ProfileFormApi {
  const [state, setState] = useState<FormState>(() => {
    return initial ? fromProfile(initial) : emptyFormState
  })

  // Re-sync when the parent swaps which row is being edited without
  // unmounting the modal, OR when the modal flips from "edit" to
  // "create" mode (initial transitions from a ProfileView to undefined).
  useEffect(() => {
    if (initial) {
      setState(fromProfile(initial))
    } else {
      setState(emptyFormState)
    }
  }, [initial])

  const setField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]): void => {
      setState((prev) => ({ ...prev, [key]: value }))
    },
    []
  )

  const reset = useCallback((): void => {
    setState(initial ? fromProfile(initial) : emptyFormState)
  }, [initial])

  return {
    state,
    setField,
    buildCreateInput: () => buildCreateInput(state),
    buildUpdateInput: (original: ProfileView) =>
      buildUpdateInput(state, original),
    reset,
  }
}
