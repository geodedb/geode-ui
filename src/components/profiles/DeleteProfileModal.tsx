import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmModal } from '../ui'
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

  const onConfirm = async () => {
    setBusy(true)
    try {
      await deleteProfile(profile.id)
      onDeleted()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmModal
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={t('profiles.delete.title')}
      body={t('profiles.delete.confirm', { name: profile.name })}
      confirmLabel={t('profiles.delete.actions.delete')}
      cancelLabel={t('profiles.delete.actions.cancel')}
      destructive
      loading={busy}
    />
  )
}
