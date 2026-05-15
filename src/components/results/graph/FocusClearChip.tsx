import React from 'react'
import styled from 'styled-components'

type TFn = (key: string, opts?: Record<string, unknown>) => string

const ChipButton = styled.button`
  position: absolute;
  top: ${({ theme }) => theme.spacing.sm};
  right: ${({ theme }) => theme.spacing.sm};
  z-index: 6;
  font-family: inherit;
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.primary};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.pill};
  padding: 4px 12px;
  cursor: pointer;
  box-shadow: ${({ theme }) => theme.shadows.md ?? theme.shadows.sm};

  &:hover,
  &:focus-visible {
    background: ${({ theme }) => theme.bg.subtle};
    outline: none;
  }
`

export type FocusClearChipProps = {
  active: boolean
  onClear: () => void
  t: TFn
}

// FocusClearChip is a small floating button rendered over the graph
// canvas whenever focus mode is active. It gives the user a stable,
// always-visible exit from focus — distinct from the inspector's
// Focus toggle (which is buried in the sidebar and disappears with
// the selection).
export const FocusClearChip: React.FC<FocusClearChipProps> = ({
  active,
  onClear,
  t,
}) => {
  if (!active) return null
  return (
    <ChipButton
      type="button"
      data-testid="graph-focus-clear-chip"
      onClick={onClear}
    >
      {t('graph.focusClearChip')}
    </ChipButton>
  )
}
