import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmModal } from '@geodedb/ui-core'
import { deleteProfile } from '../../api/profiles'
import type { ProfileView } from '../../api/profiles'

export interface Props {
  open: boolean
  onClose: () => void
  onDeleted: () => void
  profile: ProfileView
}

export const DeleteProfileModal: React.FC<Props> = ({
  open,
  onClose,
  onDeleted,
  profile,
}) => {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  // PSR-G05 (#82): surface DELETE failures in the modal so the user
  // knows the row will still be present after the next refresh and can
  // retry. Pre-fix the try/finally swallowed the rejection silently and
  // the modal sometimes closed (depending on whether onDeleted/onClose
  // had run) leaving the user with no signal that anything had failed.
  const [err, setErr] = useState<string | null>(null)

  // Reset the error whenever the modal is opened so a previous failure
  // doesn't bleed into a fresh open/close cycle.
  useEffect(() => {
    if (open) setErr(null)
  }, [open])

  const onConfirm = async () => {
    setBusy(true)
    setErr(null)
    try {
      await deleteProfile(profile.id)
      onDeleted()
      onClose()
    } catch (e: unknown) {
      // Keep the modal open and announce the failure for assistive
      // tech. The user can hit Delete again to retry; clicking Cancel
      // dismisses the dialog (and the error along with it via the
      // open=false reset above).
      setErr(e instanceof Error ? e.message : t('profiles.delete.error'))
    } finally {
      setBusy(false)
    }
  }

  const body = (
    <>
      {t('profiles.delete.confirm', { name: profile.name })}
      {err && (
        <p
          role="alert"
          data-testid="delete-profile-error"
          style={{ marginTop: '0.75rem', color: 'var(--color-danger)' }}
        >
          {err}
        </p>
      )}
    </>
  )

  return (
    <ConfirmModal
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={t('profiles.delete.title')}
      body={body}
      confirmLabel={t('profiles.delete.actions.delete')}
      cancelLabel={t('profiles.delete.actions.cancel')}
      destructive
      loading={busy}
    />
  )
}
