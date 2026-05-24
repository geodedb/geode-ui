import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  ConfirmModal,
  DataTable,
  EmptyCell,
  Field,
  Input,
  Modal,
  TableScroll,
} from '@geodedb/ui-core'
import {
  addDenyPolicy,
  removeDenyPolicy,
  listDenyPolicies,
  getDenyPolicyCount,
  type DenyPolicy,
} from '../../api/security/rlsDenyPolicies'
import { useCapabilities } from '../../hooks/useCapabilities'
import { AdminPageShell, ErrorBanner } from './AdminPageShell'

// RLS deny-policy administration page. Mounted at /admin/rls-deny.
// Sits next to PoliciesPage, mirrors its shell layout, and delegates
// to the rlsDenyPolicies wrappers for all I/O.

export const RlsDenyPoliciesPage: React.FC = () => {
  const { t } = useTranslation()
  const caps = useCapabilities()
  const gateCreate = caps.loaded && !caps.adminWritable.rlsDenyPolicies

  const [rows, setRows] = useState<DenyPolicy[]>([])
  const [count, setCount] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<DenyPolicy | null>(null)
  const [graph, setGraph] = useState('')
  const [label, setLabel] = useState('')
  const [username, setUsername] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const refetch = useCallback(async () => {
    try {
      const [list, n] = await Promise.all([
        listDenyPolicies(),
        getDenyPolicyCount(),
      ])
      setRows(list)
      setCount(n)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    refetch().catch(() => undefined)
  }, [refetch])

  const onCreate = async (): Promise<void> => {
    setSubmitting(true)
    try {
      await addDenyPolicy({ graph, label, username })
      setShowCreate(false)
      setGraph('')
      setLabel('')
      setUsername('')
      await refetch()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const onRemove = async (): Promise<void> => {
    if (!confirmRemove) return
    setSubmitting(true)
    try {
      await removeDenyPolicy(confirmRemove)
      setConfirmRemove(null)
      await refetch()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AdminPageShell
      title={t('rlsDeny.title', { count })}
      unsupportedNote={t('rlsDeny.unsupportedNote')}
      unsupportedTooltip={t('rlsDeny.unsupportedTooltip')}
      newButtonLabel={t('rlsDeny.newButton')}
      gateCreate={gateCreate}
      onCreate={() => setShowCreate(true)}
      err={err}
      testIds={{
        unsupportedNote: 'admin-rls-deny-unsupported',
        newButton: 'admin-new-rls-deny-btn',
      }}
    >
      <p className="text-body-secondary small">{t('rlsDeny.description')}</p>
      <TableScroll>
        <DataTable>
          <thead>
            <tr>
              <th>{t('rlsDeny.graphLabel')}</th>
              <th>{t('rlsDeny.labelLabel')}</th>
              <th>{t('rlsDeny.usernameLabel')}</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <EmptyCell colSpan={4}>{t('rlsDeny.description')}</EmptyCell>
              </tr>
            ) : (
              rows.map((p) => (
                <tr
                  key={`${p.graph}::${p.label}::${p.username}`}
                  data-testid={`rls-deny-row-${p.label}`}
                >
                  <td>{p.graph}</td>
                  <td>{p.label}</td>
                  <td>
                    {p.username || (
                      <em data-testid="rls-deny-all-users">
                        {t('rlsDeny.allUsersLabel')}
                      </em>
                    )}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmRemove(p)}
                      data-testid={`rls-deny-remove-${p.label}`}
                    >
                      {t('common.delete')}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </TableScroll>

      {showCreate && (
        <Modal
          open
          onClose={() => setShowCreate(false)}
          title={t('rlsDeny.newButton')}
        >
          <Field label={t('rlsDeny.graphLabel')}>
            <Input
              value={graph}
              onChange={(e) => setGraph(e.target.value)}
              autoFocus
              data-testid="rls-deny-form-graph"
            />
          </Field>
          <Field label={t('rlsDeny.labelLabel')}>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              data-testid="rls-deny-form-label"
            />
          </Field>
          <Field label={t('rlsDeny.usernameLabel')}>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              data-testid="rls-deny-form-username"
            />
          </Field>
          {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button
              onClick={onCreate}
              disabled={submitting || !graph || !label}
              data-testid="rls-deny-submit"
            >
              {t('common.create')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setShowCreate(false)}
              disabled={submitting}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </Modal>
      )}

      {confirmRemove && (
        <ConfirmModal
          open
          title={t('rlsDeny.removeConfirmTitle')}
          body={t('rlsDeny.removeConfirmBody', {
            graph: confirmRemove.graph,
            label: confirmRemove.label,
            username: confirmRemove.username || t('rlsDeny.allUsersLabel'),
          })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          destructive
          loading={submitting}
          onConfirm={onRemove}
          onClose={() => setConfirmRemove(null)}
        />
      )}
    </AdminPageShell>
  )
}
