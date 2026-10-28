import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { client } from '../../api/client'
import {
  isWireFeatureMissingError,
  wireFeatureMissingDescription,
} from '../../api/capabilities'
import { useApiResource } from '../../hooks/useApiResource'
import { useCapabilities } from '../../hooks/useCapabilities'
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
  Stack,
  TableScroll,
  Textarea,
} from '../ui'

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

const ErrorBanner = styled.div`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.bg.subtle};
  border-left: 3px solid ${({ theme }) => theme.colors.danger};
  color: ${({ theme }) => theme.text.danger};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

const Code = styled.code`
  font-family: ${({ theme }) => theme.font.family.mono};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

const UnsupportedNote = styled.span`
  font-size: ${({ theme }) => theme.font.sizes.sm};
  color: ${({ theme }) => theme.text.secondary};
`

export const PoliciesPage: React.FC = () => {
  const { t } = useTranslation()
  const { adminWritable, loaded: capsLoaded } = useCapabilities()
  const gateCreate = capsLoaded && !adminWritable.policies
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const {
    data,
    error: loadErr,
    refetch,
  } = useApiResource(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_signal) => {
      const r = await client.getPolicies({})
      return (r.policies ?? []) as Policy[]
    },
    []
  )
  const policies = data ?? []
  const err = actionErr ?? loadErr

  const onDelete = async (): Promise<void> => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await client.deleteName({ name: confirmDelete })
      setActionErr(null)
      setConfirmDelete(null)
      refetch()
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Stack $gap="md">
      <ToolBar>
        <h2>{t('policies.title', { count: policies.length })}</h2>
        {gateCreate && (
          <UnsupportedNote data-testid="admin-policies-unsupported">
            {t('policies.unsupportedNote')}
          </UnsupportedNote>
        )}
        <Button
          data-testid="admin-new-policy-btn"
          onClick={() => setShowCreate(true)}
          disabled={gateCreate}
          title={gateCreate ? t('policies.unsupportedTooltip') : undefined}
        >
          {t('policies.newButton')}
        </Button>
      </ToolBar>
      {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
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
                      onClick={() => setConfirmDelete(p.name)}
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
        <CreatePolicyModal
          onClose={() => {
            setShowCreate(false)
            refetch()
          }}
        />
      )}
      <ConfirmModal
        open={confirmDelete !== null}
        title={t('policies.deleteTitle', { name: confirmDelete ?? '' })}
        body={t('common.cannotBeUndone')}
        destructive
        loading={deleting}
        confirmLabel={t('policies.deleteConfirm')}
        onConfirm={onDelete}
        onClose={() => setConfirmDelete(null)}
      />
    </Stack>
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
