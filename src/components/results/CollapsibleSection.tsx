import React from 'react'
import styled from 'styled-components'

const Wrap = styled.section`
  border-bottom: 1px solid ${({ theme }) => theme.border.subtle};
  margin-bottom: ${({ theme }) => theme.spacing.xs};

  &:last-of-type {
    border-bottom: none;
    margin-bottom: 0;
  }
`

// Summary is a real <button> (not a <summary>) so keyboard activation
// works identically on every browser. We expose role=button +
// aria-expanded so screen readers announce the disclosure correctly,
// and chevron rotation visually reinforces the expanded/collapsed
// state.
const Summary = styled.button<{ $open: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
  width: 100%;
  padding: ${({ theme }) => theme.spacing.xs} 0;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${({ theme }) => theme.text.secondary};

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
    border-radius: ${({ theme }) => theme.radii.sm};
  }

  .chev {
    transform: ${({ $open }) => ($open ? 'rotate(90deg)' : 'rotate(0deg)')};
    transition: transform 120ms ${({ theme }) => theme.transitions.easing};
  }
`

// Body — pure layout (padding-bottom: spacing.sm → pb-2). Inlined as
// `<div className="pb-2">` per BOOTSTRAP_MIGRATION.md replacement rule.
export type CollapsibleSectionProps = {
  // Visible heading text, also used as the accessible name of the
  // toggle button.
  title: string
  // Controlled open state. The parent owns it (typically through
  // useGraphPrefs.sectionsOpen) so the choice can be persisted.
  open: boolean
  // Fired on click/keyboard-activate. Caller decides what to set.
  onToggle: () => void
  // Optional `data-testid` forwarded to the outer wrapper, so E2E and
  // unit tests can target a specific section without scoping by text.
  testId?: string
  children: React.ReactNode
}

// CollapsibleSection wraps a `<details>`-shaped block of sidebar UI
// behind a button-driven summary so the open state can be lifted to
// the orchestrator (which persists it via useGraphPrefs.sectionsOpen).
// The closed body is OMITTED from the render tree (not display:none)
// so it is also excluded from the screen-reader accessibility tree —
// matching the behavior of a real `<details>` element.
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  open,
  onToggle,
  testId,
  children,
}) => (
  <Wrap data-testid={testId}>
    <Summary type="button" $open={open} aria-expanded={open} onClick={onToggle}>
      <span className="chev" aria-hidden="true">
        ▸
      </span>
      <span>{title}</span>
    </Summary>
    {open && <div className="pb-2">{children}</div>}
  </Wrap>
)
