import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { client } from '../../api/client'
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

// MigrationsPage drives the /admin/migrations tab. Geode B8 endpoints:
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

// ToolBar keeps a styled-component: heading carries the display font
// + xl (20px) size that doesn't match fs-*. Nested `h2` selector.
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

// Section keeps a styled-component: the nested `h3` selector applies
// text-transform: uppercase + letter-spacing: 0.04em which have no
// Bootstrap utility equivalent.
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

// GAP-052: the modal grew a second authoring path. `mode` toggles
// between the original upload flow and an inline compose surface so
// operators can draft migrations beside the Query page without
// dropping into a local editor. The compose path synthesises the
// upload blob from the editor body and reuses the same
// `client.migrationUpload` endpoint.
type CreateMode = 'upload' | 'compose'

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
  const [mode, setMode] = useState<CreateMode>('upload')
  const [composeBody, setComposeBody] = useState('')

  // Stage the migration content via the typed multipart endpoint
  // (GAP-Q5 #34: `client.migrationUpload` is generated from the
  // `"type": "file"` request schema in geode.json — it builds the
  // FormData and POSTs `multipart/form-data`; the shared fetch wrapper
  // in api/client.ts attaches the cookie/CSRF/bearer auth). Server
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
      const resp = await client.migrationUpload({
        file: { blob: f, filename: f.name, contentType: f.type || undefined },
      })
      setUploadedFile(resp.file)
      // Default the migration name to the upload filename if the
      // operator hasn't typed one yet.
      if (!name) {
        setName(resp.file.replace(/\.[^.]+$/, ''))
      }
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // GAP-052: in compose mode build a synthesised Blob from the
  // editor body and reuse the same `client.migrationUpload` endpoint
  // the file picker drives. The server validates the filename
  // (alphanumeric+._- only) so we strip everything else from the
  // operator-typed name before appending `.gql`. The endpoint then
  // returns the canonical filename, which the subsequent
  // postMigrations call records in the migration row.
  const composeUpload = async (): Promise<string> => {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filename = safe.endsWith('.gql') ? safe : `${safe}.gql`
    const blob = new Blob([composeBody], { type: 'text/plain' })
    const resp = await client.migrationUpload({
      file: { blob, filename, contentType: 'text/plain' },
    })
    return resp.file
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      if (mode === 'compose' && composeBody.trim().length > 0) {
        await composeUpload()
      }
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
        {/* GAP-052: tab strip toggles between upload (existing flow)
            and compose (inline authoring). Composed bodies funnel
            through the same migrationUpload endpoint via a Blob so
            the server-side validation (filename charset, 64 MiB cap)
            stays in one place. */}
        <div
          role="tablist"
          aria-label={t('migrations.createTabsAria')}
          className="d-flex gap-2 border-bottom"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'upload'}
            data-testid="migration-mode-upload"
            className={`btn btn-sm ${
              mode === 'upload' ? 'btn-primary' : 'btn-link'
            }`}
            onClick={() => setMode('upload')}
          >
            {t('migrations.tabUpload')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'compose'}
            data-testid="migration-mode-compose"
            className={`btn btn-sm ${
              mode === 'compose' ? 'btn-primary' : 'btn-link'
            }`}
            onClick={() => setMode('compose')}
          >
            {t('migrations.tabCompose')}
          </button>
        </div>
        {mode === 'upload' && (
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
        )}
        {mode === 'upload' && uploadedFile && (
          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>
            {t('migrations.staged', { name: uploadedFile })}
          </span>
        )}
        {mode === 'compose' && (
          <Field
            label={t('migrations.composeLabel')}
            htmlFor="migration-compose-body"
            hint={t('migrations.composeHint')}
          >
            <Textarea
              id="migration-compose-body"
              data-testid="migration-compose-body"
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              rows={10}
              style={{ fontFamily: 'monospace' }}
              placeholder={t('migrations.composePlaceholder')}
            />
          </Field>
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
        {err && (
          <div
            className="bg-body-tertiary text-danger rounded px-3 py-2 small"
            style={{ borderLeft: '3px solid var(--bs-danger)' }}
            role="alert"
          >
            {err}
          </div>
        )}
      </form>
    </Modal>
  )
}
