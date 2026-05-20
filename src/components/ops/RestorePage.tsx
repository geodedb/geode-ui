import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import styled from 'styled-components'

import { client } from '../../api/client'
import { useApiResource } from '../../hooks/useApiResource'
import {
  Button,
  DedupedDatalist,
  Field,
  Input,
  Stack,
  useUniqueValues,
} from '../ui'

// RestorePage drives the /admin/restore tab. Backed by Geode B7:
//
//   restore POST /api/v1/restore -> client.restore({ file, target_time })
//
// The page accepts a `file` value via router location state when a
// user clicks "Restore" on a row in BackupPage; otherwise users type
// the filename in by hand.

// GAP-051: heading + back-link share the visual language used by
// BackupPage's ToolBar so the two halves of the snapshots workflow
// look like one product surface. The bespoke `Heading` styled-
// component shrank to a small wrapper so the breadcrumb sits flush
// above the title.
const Heading = styled.h2`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xl};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  color: ${({ theme }) => theme.text.primary};
  margin: 0;
`

const BackLink = styled(Link)`
  font-size: ${({ theme }) => theme.font.sizes.sm};
  color: ${({ theme }) => theme.text.link};
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`

export const RestorePage: React.FC = () => {
  const { t } = useTranslation()

  // GAP-autocomplete: surface existing backup names as datalist
  // suggestions on the file-name input. The fetch is best-effort —
  // if /api/v1/backups errors the input still works as a free-text
  // field. useApiResource owns its own AbortController so a mid-flight
  // fetch is cancelled if the page unmounts.
  const { data: backupsData } = useApiResource<{
    backups: Array<{ file?: string }>
  }>(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_signal) => {
      const r = (await client.getBackups({})) as {
        backups?: Array<{ file?: string }>
      }
      return { backups: r.backups ?? [] }
    },
    []
  )
  const backupOptions = useUniqueValues(
    backupsData?.backups ?? [],
    (b) => b.file
  )

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
      <BackLink to="/admin/backups" data-testid="restore-back-to-snapshots">
        {t('nav.adminTabBackToSnapshots')}
      </BackLink>
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
            list="restore-file-list"
            placeholder={t('restore.filePlaceholder')}
            value={file}
            onChange={(e) => setFile(e.target.value)}
            required
          />
          <DedupedDatalist id="restore-file-list" values={backupOptions} />
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
        <div
          className="bg-body-tertiary text-danger rounded px-3 py-2 small"
          style={{ borderLeft: '3px solid var(--bs-danger)' }}
          role="alert"
        >
          {err}
        </div>
      )}
      {okMsg && (
        <div
          className="bg-body-tertiary text-success rounded px-3 py-2 small"
          style={{ borderLeft: '3px solid var(--bs-success)' }}
          role="status"
        >
          {okMsg}
        </div>
      )}
    </Stack>
  )
}
