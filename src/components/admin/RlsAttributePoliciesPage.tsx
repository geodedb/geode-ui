import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
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
  addAttributePolicy,
  removeAttributePolicy,
  listAttributePolicies,
  type AttributePolicy,
} from '../../api/security/rlsAttributePolicies'
import { useCapabilities } from '../../hooks/useCapabilities'
import { AdminPageShell, ErrorBanner } from './AdminPageShell'

// ABAC attribute-policy admin page. Mounted at /admin/rls-attribute.
//
// listAttributePolicies returns [] on builds that lack
// gps.list_policies (501). To keep the page useful in that case we
// maintain an in-session mirror of policies the operator created
// during this session and concatenate it with the server list.

const Preview = styled.code`
  display: inline-block;
  font-family: ${({ theme }) => theme.font.family.mono};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  color: ${({ theme }) => theme.text.secondary};
`

function policyKey(p: AttributePolicy): string {
  return `${p.graph}::${p.label}::${p.rowProperty}::${p.attributeKey}`
}

export const RlsAttributePoliciesPage: React.FC = () => {
  const { t } = useTranslation()
  const caps = useCapabilities()
  const gateCreate = caps.loaded && !caps.adminWritable.rlsAttributePolicies

  const [serverList, setServerList] = useState<AttributePolicy[]>([])
  const [session, setSession] = useState<AttributePolicy[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<AttributePolicy | null>(
    null
  )
  const [graph, setGraph] = useState('')
  const [label, setLabel] = useState('')
  const [rowProperty, setRowProperty] = useState('')
  const [attributeKey, setAttributeKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [serverListEmpty, setServerListEmpty] = useState(false)

  const refetch = useCallback(async () => {
    try {
      const list = await listAttributePolicies()
      setServerList(list)
      setServerListEmpty(list.length === 0)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    refetch().catch(() => undefined)
  }, [refetch])

  // Merge server + session, dedupe by composite key (server wins).
  const seen = new Set(serverList.map(policyKey))
  const merged: AttributePolicy[] = [
    ...serverList,
    ...session.filter((p) => !seen.has(policyKey(p))),
  ]
  const showListingUnsupportedNote = serverListEmpty && session.length > 0

  const onCreate = async (): Promise<void> => {
    setSubmitting(true)
    try {
      const p: AttributePolicy = { graph, label, rowProperty, attributeKey }
      await addAttributePolicy(p)
      setSession((s) => [...s.filter((x) => policyKey(x) !== policyKey(p)), p])
      setShowCreate(false)
      setGraph('')
      setLabel('')
      setRowProperty('')
      setAttributeKey('')
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
      await removeAttributePolicy(confirmRemove)
      const k = policyKey(confirmRemove)
      setSession((s) => s.filter((x) => policyKey(x) !== k))
      setConfirmRemove(null)
      await refetch()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const previewText = `row.${rowProperty || '<row_property>'} = principal.attribute.${attributeKey || '<attribute_key>'}`

  return (
    <AdminPageShell
      title={t('rlsAttribute.title', { count: merged.length })}
      unsupportedNote={t('rlsAttribute.unsupportedNote')}
      unsupportedTooltip={t('rlsAttribute.unsupportedTooltip')}
      newButtonLabel={t('rlsAttribute.newButton')}
      gateCreate={gateCreate}
      onCreate={() => setShowCreate(true)}
      err={err}
      testIds={{
        unsupportedNote: 'admin-rls-attribute-unsupported',
        newButton: 'admin-new-rls-attribute-btn',
      }}
    >
      <p className="text-body-secondary small">
        {t('rlsAttribute.description')}
      </p>
      {showListingUnsupportedNote && (
        <p
          className="small text-body-secondary"
          data-testid="rls-attribute-listing-unsupported"
        >
          {t('rlsAttribute.listingUnsupportedNote')}
        </p>
      )}
      <TableScroll>
        <DataTable>
          <thead>
            <tr>
              <th>{t('rlsAttribute.graphLabel')}</th>
              <th>{t('rlsAttribute.labelLabel')}</th>
              <th>{t('rlsAttribute.rowPropertyLabel')}</th>
              <th>{t('rlsAttribute.attributeKeyLabel')}</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {merged.length === 0 ? (
              <tr>
                <EmptyCell colSpan={5}>
                  {t('rlsAttribute.description')}
                </EmptyCell>
              </tr>
            ) : (
              merged.map((p) => (
                <tr key={policyKey(p)} data-testid={`rls-attr-row-${p.label}`}>
                  <td>{p.graph}</td>
                  <td>{p.label}</td>
                  <td>{p.rowProperty}</td>
                  <td>{p.attributeKey}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmRemove(p)}
                      data-testid={`rls-attr-remove-${p.label}`}
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
          title={t('rlsAttribute.newButton')}
        >
          <Field label={t('rlsAttribute.graphLabel')}>
            <Input
              value={graph}
              onChange={(e) => setGraph(e.target.value)}
              autoFocus
              data-testid="rls-attr-form-graph"
            />
          </Field>
          <Field label={t('rlsAttribute.labelLabel')}>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              data-testid="rls-attr-form-label"
            />
          </Field>
          <Field label={t('rlsAttribute.rowPropertyLabel')}>
            <Input
              value={rowProperty}
              onChange={(e) => setRowProperty(e.target.value)}
              data-testid="rls-attr-form-row-property"
            />
          </Field>
          <Field label={t('rlsAttribute.attributeKeyLabel')}>
            <Input
              value={attributeKey}
              onChange={(e) => setAttributeKey(e.target.value)}
              data-testid="rls-attr-form-attribute-key"
            />
          </Field>
          <p className="small">
            {t('rlsAttribute.expressionPreview', { preview: '' })}
            <Preview data-testid="rls-attr-form-preview">{previewText}</Preview>
          </p>
          {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button
              onClick={onCreate}
              disabled={
                submitting || !graph || !label || !rowProperty || !attributeKey
              }
              data-testid="rls-attr-submit"
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
          title={t('rlsAttribute.removeConfirmTitle')}
          body={t('rlsAttribute.removeConfirmBody', {
            graph: confirmRemove.graph,
            label: confirmRemove.label,
            rowProperty: confirmRemove.rowProperty,
            attributeKey: confirmRemove.attributeKey,
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
