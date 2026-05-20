import React from 'react'
import styled from 'styled-components'

import { Button, Stack } from '@geodedb/ui-core'

// QUALITY-18 (#270): the three Admin sub-pages (PoliciesPage,
// RolesPage, UsersPage) emitted the same ToolBar + ErrorBanner
// scaffold three times with only the i18n keys differing. The shared
// shell here factors that scaffold out so each page only declares its
// title, its CTA labels, and its data-testid handles. Behaviour is
// preserved bit-for-bit:
//
//   - Title text + UnsupportedNote span + New CTA all live inside the
//     same flex ToolBar.
//   - When gateCreate is true the CTA is disabled, the UnsupportedNote
//     renders, and the title attribute carries the tooltip text.
//   - ErrorBanner renders inline below the ToolBar when err is non-null
//     with role="alert" (preserving the assistive-tech contract).
//   - `children` is the page's own body (the table + modals).
//
// The shell does NOT subscribe to i18n itself; i18n keys stay in the
// page so the verify:translations gate continues to see every literal
// reference.

// ToolBar keeps a styled-component: the heading carries
// theme.font.family.display (Sora) and a 20px display weight that
// doesn't map cleanly to Bootstrap's fs-* scale (fs-4 = 1.5rem ≈ 24px).
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

// ErrorBanner: bg-body-tertiary maps to theme.bg.subtle, text-danger maps
// to theme.text.danger, rounded to theme.radii.md, p-2 to spacing.sm/md.
// The 3px left border accent stays inline; Bootstrap's border-3 utility
// applies to all four sides. The 13px font-size is one step below
// Bootstrap's body (14px); `.small` (0.875em ≈ 12px in body context) is
// close enough for the visual intent (de-emphasised system message).
export const ErrorBanner: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...rest
}) => (
  <div
    className={[
      'bg-body-tertiary text-danger rounded px-3 py-2 small',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ')}
    style={{ borderLeft: '3px solid var(--bs-danger)' }}
    {...rest}
  >
    {children}
  </div>
)

export interface AdminPageShellProps {
  /** Localised heading rendered inside the toolbar `<h2>`. */
  title: string
  /** Localised "Unsupported" inline note shown only when gated. */
  unsupportedNote: string
  /** Localised tooltip text the disabled CTA carries. */
  unsupportedTooltip: string
  /** Localised label for the primary "New X" CTA. */
  newButtonLabel: string
  /** When true the CTA is disabled and the UnsupportedNote renders. */
  gateCreate: boolean
  /** Called when the operator clicks the CTA. */
  onCreate: () => void
  /** Optional error string to surface in the inline banner. */
  err: string | null
  /**
   * data-testid pair so per-page Playwright/Jest tests can target the
   * unsupported-note span and the New CTA without sharing test ids.
   */
  testIds: { unsupportedNote: string; newButton: string }
  children: React.ReactNode
}

export const AdminPageShell: React.FC<AdminPageShellProps> = ({
  title,
  unsupportedNote,
  unsupportedTooltip,
  newButtonLabel,
  gateCreate,
  onCreate,
  err,
  testIds,
  children,
}) => (
  <Stack $gap="md">
    <ToolBar>
      <h2>{title}</h2>
      {gateCreate && (
        <span
          data-testid={testIds.unsupportedNote}
          className="small text-body-secondary"
        >
          {unsupportedNote}
        </span>
      )}
      <Button
        data-testid={testIds.newButton}
        onClick={onCreate}
        disabled={gateCreate}
        title={gateCreate ? unsupportedTooltip : undefined}
      >
        {newButtonLabel}
      </Button>
    </ToolBar>
    {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
    {children}
  </Stack>
)

// ErrorBanner is exported at the declaration site above; children
// (the per-page create modals in RolesPage/UsersPage) reuse the same
// component for their own inline errors.
