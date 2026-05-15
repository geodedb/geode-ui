import React from 'react'
import styled from 'styled-components'

type TFn = (key: string, opts?: Record<string, unknown>) => string

const Strip = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xxs};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.bg.subtle};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.secondary};
`

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xxs};
  padding: 2px 4px 2px 8px;
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.pill};
  color: ${({ theme }) => theme.text.primary};

  button {
    background: none;
    border: none;
    cursor: pointer;
    color: ${({ theme }) => theme.text.muted};
    padding: 0 4px;
    font-size: ${({ theme }) => theme.font.sizes.sm};
    line-height: 1;
    border-radius: ${({ theme }) => theme.radii.pill};
  }

  button:hover {
    color: ${({ theme }) => theme.text.danger};
  }

  button:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

export type GraphFilterChipsProps = {
  t: TFn
  hiddenLabels: Set<string>
  onClearHidden: (label: string) => void
  clusterByLabel: boolean
  onClearCluster: () => void
  focusActive: boolean
  focusId: string | null
  focusHops: number
  onClearFocus: () => void
  pathActive: boolean
  onClearPath: () => void
}

// GraphFilterChips renders one removable pill per active filter. The
// strip is hidden entirely when no filter is on so the canvas claims
// the full height; as soon as the user hides a label, focuses a node,
// turns clustering on, or enters path mode, the strip appears between
// the toolbar and the canvas to spell out the current state.
export const GraphFilterChips: React.FC<GraphFilterChipsProps> = ({
  t,
  hiddenLabels,
  onClearHidden,
  clusterByLabel,
  onClearCluster,
  focusActive,
  focusId,
  focusHops,
  onClearFocus,
  pathActive,
  onClearPath,
}) => {
  const hidden = Array.from(hiddenLabels).sort()
  if (hidden.length === 0 && !clusterByLabel && !focusActive && !pathActive) {
    return null
  }
  return (
    <Strip data-testid="graph-filter-chips" role="status" aria-live="polite">
      {hidden.map((label) => (
        <Chip key={label} data-testid={`graph-chip-hidden-${label}`}>
          {t('graph.filterChipHidden', { label })}
          <button
            type="button"
            aria-label={t('graph.filterChipClear')}
            onClick={() => onClearHidden(label)}
          >
            ×
          </button>
        </Chip>
      ))}
      {clusterByLabel && (
        <Chip data-testid="graph-chip-cluster">
          {t('graph.filterChipCluster')}
          <button
            type="button"
            aria-label={t('graph.filterChipClear')}
            onClick={onClearCluster}
          >
            ×
          </button>
        </Chip>
      )}
      {focusActive && (
        <Chip data-testid="graph-chip-focused">
          {t('graph.filterChipFocused', {
            id: focusId ?? '',
            hops: focusHops,
          })}
          <button
            type="button"
            aria-label={t('graph.filterChipClear')}
            onClick={onClearFocus}
          >
            ×
          </button>
        </Chip>
      )}
      {pathActive && (
        <Chip data-testid="graph-chip-path">
          {t('graph.filterChipPath')}
          <button
            type="button"
            aria-label={t('graph.filterChipClear')}
            onClick={onClearPath}
          >
            ×
          </button>
        </Chip>
      )}
    </Strip>
  )
}
