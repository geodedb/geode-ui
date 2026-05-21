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

// text-align: right is the simplest way to right-align an inline-block
// summary inside a block-level <details>. The block-level Body (<pre>)
// is unaffected because it lays out as a block element with its own
// text-align: left (the pre default).
const Details = styled.details`
  margin-top: ${({ theme }) => theme.spacing.xs};
  text-align: right;
`

// The toggle anchor is right-aligned within its column so the JSON
// disclosure sits flush with the right edge of the row's Fields cell
// while the key/value list stays left-aligned.
//
// 2026-05-21 bug-fix: pre-fix this used `d-block text-end`, which
// stretched the <summary> across the full column width with the link
// text floated right — making the entire row's gutter a click target
// and looking visually like a button bar. The new layout uses
// `display: inline-block` so the summary is content-sized (only the
// "View raw JSON" text is clickable) and `margin-left: auto` inside
// a flex parent below to keep it right-aligned. `list-style: none`
// hides the native disclosure triangle marker that `d-block`
// previously stripped as a side effect.
const Summary = styled.summary`
  cursor: pointer;
  display: inline-block;
  list-style: none;
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.link};

  /* 2026-05-21 follow-up fix: Web Awesome's vendor stylesheet ships a
     global \`summary { margin-inline: calc(-1 * var(--wa-space-m)) }\`
     rule intended for its own card/expander components but applied to
     every native <summary>. Combined with our display:inline-block,
     the negative inline margin pulled the visible bounding box past
     the content edges, making the button still appear full-width
     (and click-targetable into the row gutter). Explicitly resetting
     margin, padding, and border-radius scopes WA's affordances away
     from this native usage. */
  margin: 0;
  padding: 0;
  border-radius: 0;

  /* WebKit honours the legacy ::-webkit-details-marker pseudo-element
     for the disclosure triangle; list-style: none is enough for
     Firefox/Chrome but Safari still renders the marker without this. */
  &::-webkit-details-marker {
    display: none;
  }

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
  /* Counter the parent Details text-align: right so the JSON payload
     itself stays left-aligned. */
  text-align: left;
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
