import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

// AuditRowJsonToggle — per-row disclosure that reveals the raw JSON
// payload for the audit entry. Uses native <details>/<summary> for
// zero-JS keyboard a11y (Enter/Space toggles, arrow keys traverse,
// screen readers announce the expanded state).
//
// Why opt-in: the readable key→value list (AuditFieldList) is the
// default for most operators most of the time. The raw JSON path
// stays one click away for an investigator who needs the exact
// payload shape (e.g. comparing two events that differ only in a
// nested field).
//
// Why useState alongside <details>: jsdom does not auto-toggle
// <details> when its <summary> is clicked, so the tests would
// otherwise be stuck observing a closed disclosure. Driving the
// `open` prop from React state makes the contract testable AND
// preserves the native keyboard semantics in real browsers.

const Details = styled.details`
  margin-top: ${({ theme }) => theme.spacing.xs};
`

// The toggle anchor itself is right-aligned within its column so the
// JSON disclosure sits flush with the right edge of the row's Fields
// cell while the key/value list stays left-aligned. d-block strips
// the default <summary> list-item marker so `text-end` lands the
// link cleanly on the right; Bootstrap's responsive utility stack
// applies the same alignment at every breakpoint.
const Summary = styled.summary.attrs({
  className: 'd-block text-end',
})`
  cursor: pointer;
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.link};
  &:hover {
    text-decoration: underline;
  }
`

const Body = styled.pre`
  font-family: ${({ theme }) => theme.font.family.mono};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  background: ${({ theme }) => theme.bg.subtle};
  padding: ${({ theme }) => theme.spacing.sm};
  border-radius: ${({ theme }) => theme.radii.sm};
  margin: ${({ theme }) => theme.spacing.xs} 0 0;
  max-width: 480px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
`

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export interface AuditRowJsonToggleProps {
  entry: unknown
}

export const AuditRowJsonToggle: React.FC<AuditRowJsonToggleProps> = ({
  entry,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Details data-testid="audit-json-details" open={open}>
      <Summary
        data-testid="audit-json-summary"
        onClick={(e) => {
          // Suppress the browser default toggle and drive open via
          // state — keeps jsdom and the production DOM behaviour in
          // lockstep. The native keyboard behaviour (Enter/Space on
          // summary) calls the same onClick so a11y is preserved.
          e.preventDefault()
          setOpen((v) => !v)
        }}
      >
        {open ? t('audit.hideJson') : t('audit.viewJson')}
      </Summary>
      <Body data-testid="audit-json-body">{safeStringify(entry)}</Body>
    </Details>
  )
}
