import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  Button,
  ConfirmModal,
  DataTable,
  Field,
  Input,
  Modal,
  TableScroll,
} from '@geodedb/ui-core'
import {
  listUserAttributes,
  setUserAttribute,
  removeUserAttribute,
  type UserAttribute,
} from '../../api/security/userAttributes'

// Valid attribute key shape mirrors the regex used by the geode lexer
// for identifiers: [A-Za-z_][A-Za-z0-9_]*. We validate client-side to
// give a clearer error than the wire_feature_missing 400 the server
// returns for malformed keys.
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

interface Props {
  username: string
  onClose: () => void
}

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
  min-width: 480px;
`

const RowActions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
`

// Internal merge: the server-side list (when available) plus an
// in-session mirror so the modal stays useful on builds without
// user_list_attributes (501 → wrapper returns []).
type Mirror = Record<string, string>

export const UserAttributesModal: React.FC<Props> = ({ username, onClose }) => {
  const { t } = useTranslation()
  const [serverRows, setServerRows] = useState<UserAttribute[]>([])
  const [mirror, setMirror] = useState<Mirror>({})
  const [tombstones, setTombstones] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [pageErr, setPageErr] = useState<string | null>(null)
  const [formErr, setFormErr] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listUserAttributes(username)
      setServerRows(data)
      setPageErr(null)
    } catch (e) {
      setPageErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [username])

  useEffect(() => {
    refetch().catch(() => undefined)
  }, [refetch])

  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Merge server rows with mirror; mirror wins for overlapping keys
  // (so a recent set is reflected even before refetch resolves).
  // Tombstones suppress server rows that were removed but the server
  // list may still report them (e.g. eventually-consistent backends).
  const merged: UserAttribute[] = (() => {
    const map: Map<string, string> = new Map()
    serverRows.forEach((r) => {
      if (!tombstones.has(r.key)) map.set(r.key, r.value)
    })
    Object.entries(mirror).forEach(([k, v]) => {
      if (!tombstones.has(k)) map.set(k, v)
    })
    return [...map.entries()].map(([key, value]) => ({ key, value }))
  })()

  const openAdd = (): void => {
    setNewKey('')
    setNewValue('')
    setFormErr(null)
    setAddOpen(true)
  }

  const submitAdd = async (): Promise<void> => {
    if (!KEY_RE.test(newKey)) {
      setFormErr(t('userAttributes.invalidKey'))
      return
    }
    setSubmitting(true)
    try {
      await setUserAttribute(username, newKey, newValue)
      setMirror((m) => ({ ...m, [newKey]: newValue }))
      setTombstones((ts) => {
        const next = new Set(ts)
        next.delete(newKey)
        return next
      })
      setAddOpen(false)
      setFormErr(null)
      refetch().catch(() => undefined)
    } catch (e) {
      const errObj = e as { status?: number; message?: string }
      if (errObj?.status === 501) {
        setFormErr(t('userAttributes.unsupportedTooltip'))
      } else {
        setFormErr(errObj?.message ?? String(e))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const submitRemove = async (): Promise<void> => {
    if (!confirmRemove) return
    setSubmitting(true)
    try {
      await removeUserAttribute(username, confirmRemove)
      setMirror((m) => {
        const next = { ...m }
        delete next[confirmRemove]
        return next
      })
      setTombstones((ts) => new Set(ts).add(confirmRemove))
      setConfirmRemove(null)
      refetch().catch(() => undefined)
    } catch (e) {
      setPageErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const closeLabel = t('userAttributes.closeLabel')

  return (
    <Modal
      open
      onClose={onClose}
      title={t('userAttributes.title')}
      closeLabel={closeLabel}
    >
      <Body>
        <p>{t('userAttributes.description')}</p>
        {pageErr && (
          <div role="alert" data-testid="user-attributes-error">
            {pageErr}
          </div>
        )}
        {merged.length === 0 && !loading ? (
          <p data-testid="user-attributes-empty">
            {t('userAttributes.noneYet')}
          </p>
        ) : (
          <TableScroll>
            <DataTable>
              <thead>
                <tr>
                  <th>{t('userAttributes.keyLabel')}</th>
                  <th>{t('userAttributes.valueLabel')}</th>
                  <th aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {merged.map((row) => (
                  <tr key={row.key}>
                    <td>{row.key}</td>
                    <td>{row.value}</td>
                    <td>
                      <RowActions>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmRemove(row.key)}
                          data-testid={`user-attr-remove-${row.key}`}
                        >
                          {t('common.delete')}
                        </Button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </TableScroll>
        )}
        <Button onClick={openAdd} data-testid="user-attributes-add-btn">
          {t('userAttributes.addButton')}
        </Button>
      </Body>

      {addOpen && (
        <Modal
          open
          onClose={() => setAddOpen(false)}
          title={t('userAttributes.addButton')}
        >
          <Body>
            <Field label={t('userAttributes.keyLabel')}>
              <Input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                autoFocus
                data-testid="user-attr-new-key"
              />
            </Field>
            <Field label={t('userAttributes.valueLabel')}>
              <Input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                data-testid="user-attr-new-value"
              />
            </Field>
            {formErr && (
              <div role="alert" data-testid="user-attributes-form-error">
                {formErr}
              </div>
            )}
            <RowActions>
              <Button
                onClick={submitAdd}
                disabled={submitting}
                data-testid="user-attr-submit-btn"
              >
                {t('common.create')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setAddOpen(false)}
                disabled={submitting}
              >
                {t('common.cancel')}
              </Button>
            </RowActions>
          </Body>
        </Modal>
      )}

      {confirmRemove !== null && (
        <ConfirmModal
          open
          title={t('userAttributes.removeConfirmTitle')}
          body={t('userAttributes.removeConfirmBody', {
            key: confirmRemove,
            username,
          })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          destructive
          loading={submitting}
          onConfirm={submitRemove}
          onClose={() => setConfirmRemove(null)}
        />
      )}
    </Modal>
  )
}
