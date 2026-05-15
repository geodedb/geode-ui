// TLSFieldset — encapsulates the three TLS PEM textareas
// (caPem, clientCertPem, clientKeyPem) and their per-field "Browse"
// buttons (Electron only). Pre-refactor each field had its own
// nearly-identical browse handler (browseCAPem / browseClientCertPem
// / browseClientKeyPem) and an inline change handler that mutated
// FormState by spreading + assigning the matching key.
//
// GAP-Q05 / Q06 (#95 / #96): collapse the three browse handlers into
// one parameterised `browse(fieldKey)` that picks a PEM file and
// dispatches the result through the supplied `setField` callback.
// The textareas themselves are emitted by a small per-field helper
// (PemRow) that takes the same fieldKey + label/id pair so the
// presentational shape stays uniform across the three fields.
//
// We deliberately keep the translation keys as string literals at
// the call site (rather than threading through a spec table) so the
// i18n key extractor in scripts/validate-translations.mjs continues
// to see them — the extractor is a regex over literal-string t()
// arguments and cannot resolve dynamic key paths.

import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Button, Field, Textarea } from '../ui'
import { isElectron, pickPemFile } from '../../api/electron-bridge'
import { FormState } from './useProfileForm'

const Section = styled.section`
  margin-top: ${({ theme }) => theme.spacing.md};
  border-top: 1px solid ${({ theme }) => theme.border.default};
  padding-top: ${({ theme }) => theme.spacing.md};
`
const SectionTitle = styled.h3`
  font-size: ${({ theme }) => theme.font.sizes.sm};
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
`

type TLSFieldKey = 'caPem' | 'clientCertPem' | 'clientKeyPem'

interface PemRowProps {
  label: string
  inputId: string
  fieldKey: TLSFieldKey
  value: string
  setField: (key: TLSFieldKey, value: string) => void
  browseLabel: string
  showBrowse: boolean
  onBrowse: (key: TLSFieldKey) => void
}

const PemRow: React.FC<PemRowProps> = ({
  label,
  inputId,
  fieldKey,
  value,
  setField,
  browseLabel,
  showBrowse,
  onBrowse,
}) => (
  <Field label={label} htmlFor={inputId}>
    {showBrowse ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onBrowse(fieldKey)}
      >
        {browseLabel}
      </Button>
    ) : null}
    <Textarea
      id={inputId}
      value={value}
      onChange={(e) => setField(fieldKey, e.target.value)}
    />
  </Field>
)

export interface TLSFieldsetProps {
  state: Pick<FormState, TLSFieldKey>
  setField: (key: TLSFieldKey, value: string) => void
}

export const TLSFieldset: React.FC<TLSFieldsetProps> = ({
  state,
  setField,
}) => {
  const { t } = useTranslation()
  const showBrowse = isElectron()
  const browseLabel = t('electron.browse')

  // Single parameterised browse handler — replaces three near-
  // identical browseCAPem / browseClientCertPem / browseClientKeyPem
  // closures from the pre-refactor modal.
  const browse = (fieldKey: TLSFieldKey): void => {
    pickPemFile()
      .then((text) => {
        if (text !== null) setField(fieldKey, text)
      })
      .catch(() => undefined)
  }

  return (
    <Section>
      <SectionTitle>{t('profiles.editor.section.tls')}</SectionTitle>
      <PemRow
        label={t('profiles.editor.field.caPem')}
        inputId="profile-caPem"
        fieldKey="caPem"
        value={state.caPem}
        setField={setField}
        browseLabel={browseLabel}
        showBrowse={showBrowse}
        onBrowse={browse}
      />
      <PemRow
        label={t('profiles.editor.field.clientCertPem')}
        inputId="profile-clientCertPem"
        fieldKey="clientCertPem"
        value={state.clientCertPem}
        setField={setField}
        browseLabel={browseLabel}
        showBrowse={showBrowse}
        onBrowse={browse}
      />
      <PemRow
        label={t('profiles.editor.field.clientKeyPem')}
        inputId="profile-clientKeyPem"
        fieldKey="clientKeyPem"
        value={state.clientKeyPem}
        setField={setField}
        browseLabel={browseLabel}
        showBrowse={showBrowse}
        onBrowse={browse}
      />
    </Section>
  )
}
