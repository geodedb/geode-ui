import React from 'react'
import styled from 'styled-components'

import { Button, Stack } from '../ui'

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

const UnsupportedNote = styled.span`
  font-size: ${({ theme }) => theme.font.sizes.sm};
  color: ${({ theme }) => theme.text.secondary};
`

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
        <UnsupportedNote data-testid={testIds.unsupportedNote}>
          {unsupportedNote}
        </UnsupportedNote>
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

// Re-export the inline ErrorBanner so children (the create modals)
// can render the same styled element for their own inline errors. The
// scaffold's ErrorBanner is what the top-of-page actionErr/loadErr
// surface reuses; the modal-internal ErrorBanner is the SAME styled
// component, exported here so the modals don't redeclare it.
export { ErrorBanner }
