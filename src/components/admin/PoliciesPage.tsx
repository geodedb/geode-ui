import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { client } from '../../api/client'
import {
  isWireFeatureMissingError,
  wireFeatureMissingDescription,
} from '../../api/capabilities'
import {
  RBAC_RESOURCES,
  RLS_OPERATIONS,
  type RlsOperation,
} from '../../lib/rbacVocab'
import {
  Button,
  ConfirmModal,
  DataTable,
  EmptyCell,
  Field,
  Input,
  Modal,
  Select,
  TableScroll,
  Textarea,
} from '../ui'
import { AdminPageShell, ErrorBanner } from './AdminPageShell'
import { useAdminListPage } from './useAdminListPage'

// PoliciesPage drives the /admin/policies tab (Geode B6 endpoints):
//
//   list    GET    /api/v1/policies         -> client.getPolicies
//   create  POST   /api/v1/policies         -> client.postPolicies
//   delete  DELETE /api/v1/policies/{name}  -> client.deleteName
//
// The generator emits `deleteName` (rather than `deletePolicy`) because
// the path leaf is the parameter `{name}`. PolicyList.policies is
// `Array<unknown>`; we cast each entry to the structural Policy shape.
type Policy = {
  name: string
  expression?: string
  resource?: string
}

const Code = styled.code`
  font-family: ${({ theme }) => theme.font.family.mono};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

export const PoliciesPage: React.FC = () => {
  const { t } = useTranslation()
  // QUALITY-18 (#270): scaffold (state, capabilities probe, list
  // fetch, delete handler) lives in useAdminListPage. The page only
  // declares the resource-specific shape: the AdminWritable key, the
  // typed fetcher, and the per-id delete call.
  const page = useAdminListPage<Policy>({
    resource: 'policies',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    fetcher: async (_signal) => {
      const r = await client.getPolicies({})
      return ((r.policies ?? []) as Policy[]) ?? []
    },
    deleter: (name) => client.deleteName({ name }).then(() => undefined),
  })
  const policies = page.rows

  return (
    <AdminPageShell
      title={t('policies.title', { count: policies.length })}
      unsupportedNote={t('policies.unsupportedNote')}
      unsupportedTooltip={t('policies.unsupportedTooltip')}
      newButtonLabel={t('policies.newButton')}
      gateCreate={page.gateCreate}
      onCreate={page.openCreate}
      err={page.err}
      testIds={{
        unsupportedNote: 'admin-policies-unsupported',
        newButton: 'admin-new-policy-btn',
      }}
    >
      <TableScroll>
        <DataTable>
          <thead>
            <tr>
              <th>{t('policies.columnName')}</th>
              <th>{t('policies.columnResource')}</th>
              <th>{t('policies.columnExpression')}</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {policies.length === 0 ? (
              <tr>
                <EmptyCell colSpan={4}>{t('policies.empty')}</EmptyCell>
              </tr>
            ) : (
              policies.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td>{p.resource ?? ''}</td>
                  <td>
                    <Code>{p.expression ?? ''}</Code>
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => page.openConfirm(p.name)}
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
      {page.showCreate && <CreatePolicyModal onClose={page.closeCreate} />}
      <ConfirmModal
        open={page.confirmDelete !== null}
        title={t('policies.deleteTitle', { name: page.confirmDelete ?? '' })}
        body={t('common.cannotBeUndone')}
        destructive
        loading={page.deleting}
        confirmLabel={t('policies.deleteConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={page.onDelete}
        onClose={page.closeConfirm}
      />
    </AdminPageShell>
  )
}

// Compose Geode's structured RowLevelPolicy fields into the wire
// `expression` string the server carries verbatim into
// `CREATE POLICY <name> [ON <resource>] AS '<expression>'`. The shape
// mirrors SQL-ish row-level-security syntax: `FOR <op> USING (<pred>)`
// with an optional `WITH CHECK (<pred>)`. The structured `table` field
// maps onto the existing `resource` wire field.
function composePolicyExpression(
  operation: RlsOperation,
  using: string,
  check: string
): string {
  let expr = `FOR ${operation} USING (${using.trim()})`
  const c = check.trim()
  if (c.length > 0) {
    expr += ` WITH CHECK (${c})`
  }
  return expr
}

const CreatePolicyModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [operation, setOperation] = useState<RlsOperation>('all')
  const [table, setTable] = useState('')
  const [usingClause, setUsingClause] = useState('')
  const [checkClause, setCheckClause] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const expression = composePolicyExpression(
        operation,
        usingClause,
        checkClause
      )
      await client.postPolicies({ name, resource: table, expression })
      onClose()
    } catch (e2: unknown) {
      if (isWireFeatureMissingError(e2)) {
        setErr(
          wireFeatureMissingDescription(e2) ?? t('policies.wireFeatureMissing')
        )
      } else {
        setErr(e2 instanceof Error ? e2.message : String(e2))
      }
    } finally {
      setBusy(false)
    }
  }

  const modalFooter = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={busy}>
        {t('common.cancel')}
      </Button>
      <Button form="create-policy-form" type="submit" loading={busy}>
        {t('common.create')}
      </Button>
    </>
  )

  return (
    <Modal
      open
      onClose={onClose}
      title={t('policies.createTitle')}
      footer={modalFooter}
      closeLabel={t('common.closeDialog')}
    >
      <form
        id="create-policy-form"
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <Field label={t('policies.fieldName')} htmlFor="cp-name" required>
          <Input
            id="cp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label={t('policies.operationLabel')} htmlFor="cp-operation">
          <Select
            id="cp-operation"
            data-testid="policy-operation-select"
            value={operation}
            onChange={(e) => setOperation(e.target.value as RlsOperation)}
          >
            {RLS_OPERATIONS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('policies.tableLabel')}
          htmlFor="cp-table"
          hint={t('policies.tableHint')}
        >
          <Input
            id="cp-table"
            data-testid="policy-table-input"
            list="policy-table-suggestions"
            value={table}
            onChange={(e) => setTable(e.target.value)}
          />
          <datalist id="policy-table-suggestions">
            {RBAC_RESOURCES.map((r) => (
              <option key={r} value={r} label={r} />
            ))}
          </datalist>
        </Field>
        <Field
          label={t('policies.usingLabel')}
          htmlFor="cp-using"
          hint={t('policies.usingHint')}
          required
        >
          <Textarea
            id="cp-using"
            data-testid="policy-using-textarea"
            value={usingClause}
            onChange={(e) => setUsingClause(e.target.value)}
            rows={2}
            required
          />
        </Field>
        <Field
          label={t('policies.checkLabel')}
          htmlFor="cp-check"
          hint={t('policies.checkHint')}
        >
          <Textarea
            id="cp-check"
            data-testid="policy-check-textarea"
            value={checkClause}
            onChange={(e) => setCheckClause(e.target.value)}
            rows={2}
          />
        </Field>
        {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
      </form>
    </Modal>
  )
}
