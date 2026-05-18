import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import styled from 'styled-components'

import { client } from '../../api/client'
import type { Theme } from '../../theme'
import { Button, Field, Input, Stack } from '../ui'

interface ToneArgs {
  theme: Theme
  $tone: 'ok' | 'err'
}

function bannerBorder({ $tone, theme }: ToneArgs): string {
  return $tone === 'err' ? theme.colors.danger : theme.colors.success
}

function bannerColor({ $tone, theme }: ToneArgs): string {
  return $tone === 'err' ? theme.text.danger : theme.text.success
}

// RestorePage drives the /admin/restore tab. Backed by Geode B7:
//
//   restore POST /api/v1/restore -> client.restore({ file, target_time })
//
// The page accepts a `file` value via router location state when a
// user clicks "Restore" on a row in BackupPage; otherwise users type
// the filename in by hand.
const Heading = styled.h2`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xl};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  color: ${({ theme }) => theme.text.primary};
  margin: 0;
`

const Banner = styled.div<{ $tone: 'ok' | 'err' }>`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.bg.subtle};
  border-left: 3px solid ${bannerBorder};
  color: ${bannerColor};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

export const RestorePage: React.FC = () => {
  const { t } = useTranslation()
  const location = useLocation()
  const [file, setFile] = useState('')
  const [targetTime, setTargetTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // BackupPage navigates here with location.state.file when the user
  // clicks "Restore" on a row; populate the file field on first render.
  useEffect(() => {
    const state = location.state as { file?: string } | null
    if (state && typeof state.file === 'string') {
      setFile(state.file)
    }
  }, [location.state])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    setOkMsg(null)
    try {
      await client.restore({ file, target_time: targetTime })
      setOkMsg(t('restore.started'))
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setBusy(false)
    }
  }

  // onUpload posts the selected file via the typed multipart endpoint
  // (GAP-Q5 #34: `client.backupUpload` is generated from the
  // `"type": "file"` request schema in geode.json — it builds the
  // FormData and POSTs `multipart/form-data`; the shared fetch wrapper
  // in api/client.ts attaches cookie/CSRF/bearer auth). Server
  // validates the filename (alphanumeric+._- only), enforces the
  // 64 MiB cap, and returns the stored filename + size; we populate
  // the `file` field so the operator can submit Restore against it.
  const onUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true)
    setErr(null)
    setOkMsg(null)
    try {
      const resp = await client.backupUpload({
        file: { blob: f, filename: f.name, contentType: f.type || undefined },
      })
      setFile(resp.file)
      setOkMsg(
        t('restore.uploaded', { name: resp.file, size: resp.size_bytes })
      )
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  let restoreLabel = t('common.restore')
  if (uploading) restoreLabel = t('common.uploading')

  return (
    <Stack $gap="md">
      <Heading>{t('restore.title')}</Heading>
      <form
        className="d-flex flex-column gap-3"
        style={{ maxWidth: '480px' }}
        onSubmit={submit}
      >
        <Field label={t('restore.fieldUpload')} htmlFor="rp-upload">
          <input
            id="rp-upload"
            ref={fileInputRef}
            type="file"
            onChange={onUpload}
            disabled={uploading || busy}
          />
        </Field>
        <Field label={t('restore.fieldFile')} htmlFor="rp-file" required>
          <Input
            id="rp-file"
            placeholder={t('restore.filePlaceholder')}
            value={file}
            onChange={(e) => setFile(e.target.value)}
            required
          />
        </Field>
        <Field
          label={t('restore.fieldTargetTime')}
          htmlFor="rp-target-time"
          hint={t('restore.targetTimeHint')}
        >
          <Input
            id="rp-target-time"
            placeholder="2025-01-01T00:00:00Z"
            value={targetTime}
            onChange={(e) => setTargetTime(e.target.value)}
          />
        </Field>
        <Button type="submit" loading={busy} disabled={uploading}>
          {restoreLabel}
        </Button>
      </form>
      {err && (
        <Banner $tone="err" role="alert">
          {err}
        </Banner>
      )}
      {okMsg && (
        <Banner $tone="ok" role="status">
          {okMsg}
        </Banner>
      )}
    </Stack>
  )
}
