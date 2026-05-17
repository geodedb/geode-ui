import { useCallback, useState } from 'react'

import { useApiResource } from '../../hooks/useApiResource'
import {
  useCapabilities,
  type UseCapabilitiesResult,
} from '../../hooks/useCapabilities'
import type { AdminWritable } from '../../api/capabilities'

// QUALITY-18 (#270): the three Admin sub-pages (PoliciesPage,
// RolesPage, UsersPage) share a near-identical scaffold:
//
//   1. State: actionErr, showCreate, confirmDelete, deleting.
//   2. useApiResource to fetch the listing.
//   3. useCapabilities to compute gateCreate from the `adminWritable`
//      flag for this resource.
//   4. onDelete handler that calls a per-resource client method, clears
//      its error, closes the confirm modal, and refetches.
//
// `useAdminListPage<T>` lifts that scaffold out of the page component
// so each page declares only the resource-specific shape (the
// `adminWritable` key, the fetcher, and the per-id delete call) and
// gets a uniform handle pack back. The page's render code is unchanged
// in behaviour but ~50 LOC shorter.
//
// Type parameters:
//   T - the row shape returned by the listing fetcher.
//   IDArg - the wire-name keyed argument the per-id delete takes.
//   The two are independent: rows may have any shape, while the delete
//   path needs only the id string (the page picks which row column is
//   the id).
//
// Design notes:
// - The hook does NOT couple to a specific `client.*` method; the page
//   supplies `fetcher` and `deleter` closures so genapi method names
//   (which differ per resource — `deleteName`, `deleteRole`,
//   `deleteUsername`) stay in the page that uses them.
// - The hook does NOT subscribe to i18n; surfaces are plain strings
//   and message keys live in the page so the verify:translations gate
//   still sees them.
// - The hook deliberately re-uses `useCapabilities` per page rather
//   than reading a shared context. Capabilities is already cached
//   inside useApiResource at the API layer; the duplicate calls are
//   cheap and keep the hook surface dependency-free.

export interface UseAdminListPageOptions<T> {
  /** The AdminWritable flag this resource lives under. */
  resource: keyof AdminWritable
  /**
   * Fetcher that returns the typed listing for this resource. Wraps
   * the genapi client call; receives an AbortSignal it can forward.
   */
  fetcher: (signal: AbortSignal) => Promise<T[]>
  /**
   * Per-id deleter. Receives the row id selected via openConfirm; the
   * page maps that id onto the wire-name (`name`, `role`, `username`,
   * etc.) at the call site.
   */
  deleter: (id: string) => Promise<void>
}

export interface AdminListPageHandle<T> {
  /** Resolved rows; `[]` until the first fetch lands. */
  rows: T[]
  /**
   * The error string to surface — the union of an in-flight delete
   * failure and a load failure. `null` means no error to display.
   */
  err: string | null
  /** Forces a fresh listing fetch. */
  refetch: () => void
  /**
   * `true` once the capabilities probe has confirmed the connected
   * Geode build lacks this resource's wire DDL — the New CTA should
   * disable + render its tooltip. False during the probe and on
   * supported builds.
   */
  gateCreate: boolean
  /** Capabilities probe handle so the page can render finer-grained UI. */
  capabilities: UseCapabilitiesResult
  /** The current "create modal open" state. */
  showCreate: boolean
  openCreate: () => void
  closeCreate: () => void
  /** The id selected for delete-confirm, or null when no modal is open. */
  confirmDelete: string | null
  openConfirm: (id: string) => void
  closeConfirm: () => void
  /** True while the delete RPC is in flight. */
  deleting: boolean
  /**
   * Invokes the configured deleter for the currently-selected
   * `confirmDelete`. On success: clears actionErr, closes the modal,
   * refetches. On error: surfaces the error message and leaves the
   * modal open so the operator can retry.
   */
  onDelete: () => Promise<void>
}

export function useAdminListPage<T>(
  opts: UseAdminListPageOptions<T>
): AdminListPageHandle<T> {
  const capabilities = useCapabilities()
  const { adminWritable, loaded: capsLoaded } = capabilities
  const gateCreate = capsLoaded && !adminWritable[opts.resource]

  const [actionErr, setActionErr] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { data, error: loadErr, refetch } = useApiResource(opts.fetcher, [])
  const rows: T[] = data ?? []
  const err = actionErr ?? loadErr

  const openCreate = useCallback(() => setShowCreate(true), [])
  const closeCreate = useCallback(() => {
    setShowCreate(false)
    refetch()
  }, [refetch])

  const openConfirm = useCallback((id: string) => setConfirmDelete(id), [])
  const closeConfirm = useCallback(() => setConfirmDelete(null), [])

  const { deleter } = opts
  const onDelete = useCallback(async (): Promise<void> => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleter(confirmDelete)
      setActionErr(null)
      setConfirmDelete(null)
      refetch()
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, deleter, refetch])

  return {
    rows,
    err,
    refetch,
    gateCreate,
    capabilities,
    showCreate,
    openCreate,
    closeCreate,
    confirmDelete,
    openConfirm,
    closeConfirm,
    deleting,
    onDelete,
  }
}
