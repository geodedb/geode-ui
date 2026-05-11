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
  Button,
  ConfirmModal,
  DataTable,
  EmptyCell,
  Field,
  Input,
  Modal,
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
      return ((r.policies ?? []) as Policy[]) ?? []
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

const CreatePolicyModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [resource, setResource] = useState('')
  const [expression, setExpression] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await client.postPolicies({ name, resource, expression })
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
        <Field
          label={t('policies.fieldResource')}
          htmlFor="cp-resource"
          hint={t('policies.resourceHint')}
        >
          <Input
            id="cp-resource"
            value={resource}
            onChange={(e) => setResource(e.target.value)}
          />
        </Field>
        <Field
          label={t('policies.fieldExpression')}
          htmlFor="cp-expression"
          required
        >
          <Textarea
            id="cp-expression"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            rows={3}
            required
          />
        </Field>
        {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
      </form>
    </Modal>
  )
}
