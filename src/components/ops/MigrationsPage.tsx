import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { client } from '../../api/client'
import { auth } from '../../api/auth'
import { getCsrfToken } from '../../api/csrf'
import { useApiResource } from '../../hooks/useApiResource'
import {
  Button,
  DataTable,
  EmptyCell,
  Field,
  Input,
  Modal,
  Stack,
  TableScroll,
  Textarea,
} from '../ui'

// MigrationsPage drives the /ops/migrations tab. Geode B8 endpoints:
//
//   list   GET    /api/v1/migrations             -> client.getMigrations
//   create POST   /api/v1/migrations             -> client.postMigrations
//   run    POST   /api/v1/migrations/run         -> client.postMigrationsRun
//   sign   POST   /api/v1/migrations/{name}/sign -> client.sign
//
// MigrationStatus.applied is `Array<unknown>`; we cast each entry to the
// structural Migration shape because the runtime payload is stable.
type Migration = {
  name: string
  applied_at?: string
  signed_by?: string
  description?: string
}

const ToolBar = styled.header`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  align-items: center;
  flex-wrap: wrap;

  h2 {
    flex: 1 1 auto;
    font-family: ${({ theme }) => theme.font.family.display};
    font-size: ${({ theme }) => theme.font.sizes.xl};
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    color: ${({ theme }) => theme.text.primary};
    margin: 0;
  }
`

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};

  h3 {
    font-family: ${({ theme }) => theme.font.family.display};
    font-size: ${({ theme }) => theme.font.sizes.md};
    color: ${({ theme }) => theme.text.secondary};
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0;
  }
`

const ErrorBanner = styled.div`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.bg.subtle};
  border-left: 3px solid ${({ theme }) => theme.colors.danger};
  color: ${({ theme }) => theme.text.danger};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

const OkBanner = styled.div`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.bg.subtle};
  border-left: 3px solid ${({ theme }) => theme.colors.success};
  color: ${({ theme }) => theme.text.success};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

type MigrationsView = {
  applied: Migration[]
  pending: string[]
}

export const MigrationsPage: React.FC = () => {
  const { t } = useTranslation()
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)

  const {
    data,
    error: loadErr,
    refetch,
  } = useApiResource<MigrationsView>(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_signal) => {
      const r = await client.getMigrations({})
      return {
        applied: ((r.applied ?? []) as Migration[]) ?? [],
        pending: ((r.pending ?? []) as string[]) ?? [],
      }
    },
    []
  )
  const applied = data?.applied ?? []
  const pending = data?.pending ?? []
  const err = actionErr ?? loadErr

  const onRunPending = async (): Promise<void> => {
    setBusy(true)
    setActionErr(null)
    setOkMsg(null)
    try {
      const r = await client.postMigrationsRun({})
      const n = (r.applied ?? []).length
      setOkMsg(t('migrations.appliedToast', { count: n }))
      refetch()
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onSign = async (name: string): Promise<void> => {
    try {
      await client.sign({ name })
      setActionErr(null)
      refetch()
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Stack $gap="lg">
      <ToolBar>
        <h2>{t('migrations.title')}</h2>
        <Button onClick={() => setShowCreate(true)}>
          {t('migrations.newButton')}
        </Button>
        <Button
          variant="secondary"
          onClick={onRunPending}
          loading={busy}
          disabled={pending.length === 0}
        >
          {t('migrations.runPending', { count: pending.length })}
        </Button>
      </ToolBar>
      {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
      {okMsg && <OkBanner role="status">{okMsg}</OkBanner>}
      <Section>
        <h3>{t('migrations.pendingHeading', { count: pending.length })}</h3>
        <TableScroll>
          <DataTable>
            <thead>
              <tr>
                <th>{t('migrations.columnName')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 ? (
                <tr>
                  <EmptyCell colSpan={2}>
                    {t('migrations.emptyPending')}
                  </EmptyCell>
                </tr>
              ) : (
                pending.map((name) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onSign(name)}
                      >
                        {t('common.sign')}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </TableScroll>
      </Section>
      <Section>
        <h3>{t('migrations.appliedHeading', { count: applied.length })}</h3>
        <TableScroll>
          <DataTable>
            <thead>
              <tr>
                <th>{t('migrations.columnName')}</th>
                <th>{t('migrations.columnAppliedAt')}</th>
                <th>{t('migrations.columnSignedBy')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {applied.length === 0 ? (
                <tr>
                  <EmptyCell colSpan={4}>
                    {t('migrations.emptyApplied')}
                  </EmptyCell>
                </tr>
              ) : (
                applied.map((m) => (
                  <tr key={m.name}>
                    <td>{m.name}</td>
                    <td>{m.applied_at ?? ''}</td>
                    <td>{m.signed_by ?? ''}</td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onSign(m.name)}
                      >
                        {t('common.sign')}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </TableScroll>
      </Section>
      {showCreate && (
        <CreateMigrationModal
          onClose={() => {
            setShowCreate(false)
            refetch()
          }}
        />
      )}
    </Stack>
  )
}

const CreateMigrationModal: React.FC<{ onClose: () => void }> = ({
  onClose,
}) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [uploadedFile, setUploadedFile] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Stage the migration content via the multipart endpoint. Server
  // returns the canonical filename; we record it locally so the
  // subsequent postMigrations call can reference it once Geode's wire
  // dialect grows a "CREATE MIGRATION FROM FILE" form. Today the file
  // is simply staged on disk for an operator to pick up.
  const onUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true)
    setErr(null)
    try {
      const form = new FormData()
      form.append('file', f)
      // SEC-F7 (#62 S3c): cookie-mode auth carries the JWT via the
      // browser-managed geode-ui-auth cookie on credentials:'same-origin'.
      // For a state-changing POST we must also attach the X-CSRF-Token
      // header that pairs with the geode-ui-csrf cookie. The legacy
      // bearer-token path is preserved when the backout flag is set
      // (auth.getToken() returns the stored token only in legacy mode).
      const tok = auth.getToken() ?? ''
      const csrf = getCsrfToken()
      const headers: Record<string, string> = {}
      if (tok) headers.Authorization = `Bearer ${tok}`
      if (csrf) headers['X-CSRF-Token'] = csrf
      const res = await fetch('/api/v1/migrations/upload', {
        method: 'POST',
        headers,
        body: form,
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error_description?: string
          error?: string
        }
        throw new Error(
          j.error_description ||
            j.error ||
            t('errors.uploadFailed', { status: res.status })
        )
      }
      const j = (await res.json()) as { file: string }
      setUploadedFile(j.file)
      // Default the migration name to the upload filename if the
      // operator hasn't typed one yet.
      if (!name) {
        setName(j.file.replace(/\.[^.]+$/, ''))
      }
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await client.postMigrations({ name, description })
      onClose()
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setBusy(false)
    }
  }

  let createLabel = t('common.create')
  if (uploading) createLabel = t('common.uploading')

  const modalFooter = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button
        form="create-migration-form"
        type="submit"
        loading={busy}
        disabled={uploading}
      >
        {createLabel}
      </Button>
    </>
  )

  return (
    <Modal
      open
      onClose={onClose}
      title={t('migrations.createTitle')}
      footer={modalFooter}
    >
      <form
        id="create-migration-form"
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <Field
          label={t('migrations.uploadLabel')}
          htmlFor="migration-upload-input"
        >
          <input
            id="migration-upload-input"
            ref={fileInputRef}
            type="file"
            onChange={onUpload}
            disabled={uploading || busy}
          />
        </Field>
        {uploadedFile && (
          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>
            {t('migrations.staged', { name: uploadedFile })}
          </span>
        )}
        <Field label={t('migrations.fieldName')} htmlFor="cm-name" required>
          <Input
            id="cm-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field
          label={t('migrations.fieldDescription')}
          htmlFor="cm-description"
        >
          <Textarea
            id="cm-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </Field>
        {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
      </form>
    </Modal>
  )
}
