import styled from 'styled-components'

// Wrap is the grid container for the graph view. In fill mode the
// sidebar stacks below the canvas (single column) so the canvas claims
// the full width of the overlay. The side-by-side 1fr/280px layout — and
// its below-md collapse — is kept for the inline result panel. When the
// sidebar is collapsed the grid is a single 1fr column regardless of
// mode (the Side isn't rendered) so the canvas takes the whole width.
export const Wrap = styled.div<{
  $fill: boolean
  $sidebarCollapsed: boolean
}>`
  display: grid;
  grid-template-columns: ${({ $fill, $sidebarCollapsed }) => {
    return $sidebarCollapsed || $fill ? '1fr' : '1fr 280px'
  }};
  gap: ${({ theme }) => theme.spacing.sm};
  ${({ $fill }) => ($fill ? 'height: 100%;' : '')}

  @media (max-width: ${({ theme }) => theme.breakpoints.md - 0.02}px) {
    grid-template-columns: 1fr;
  }
`

// CanvasArea holds the Cytoscape canvas plus any absolutely-positioned
// overlays (empty-graph state, build-error banner). Position-relative
// so the overlay can stack on top of the canvas without entering
// Cytoscape's internal DOM tree. `min-width: 0` lets this `1fr` grid
// track shrink below the intrinsic width of the Cytoscape <canvas> —
// without it, after the sidebar is collapsed (canvas sized to the full
// width) and re-expanded the `1fr 280px` grid can't fit, so the 280px
// sidebar (the property inspector lives there) is pushed off the right
// edge.
export const CanvasArea = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: ${({ theme }) => theme.spacing.xs};
`

export const Canvas = styled.div<{ $height: number }>`
  height: ${({ $height }) => $height}px;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  background: ${({ theme }) => theme.bg.graphCanvas};
`

// Path-mode status line — shown under the toolbar while path mode is
// active ("Click the start node" / "Click the end node" / the result).
export const PathStatus = styled.div`
  padding: ${({ theme }) => theme.spacing.xxs}
    ${({ theme }) => theme.spacing.sm};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.secondary};
  background: ${({ theme }) => theme.bg.subtle};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.sm};
`

export const Overlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.md};
  pointer-events: none;
  color: ${({ theme }) => theme.text.muted};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  font-style: italic;
  text-align: center;
`

export const ErrorBanner = styled.div`
  position: absolute;
  inset: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.sm}
    auto;
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.colors.danger};
  border-left-width: 3px;
  color: ${({ theme }) => theme.text.danger};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  box-shadow: ${({ theme }) => theme.shadows.sm};
`

export const ControlsBlock = styled.section`
  margin-bottom: ${({ theme }) => theme.spacing.sm};
  padding-bottom: ${({ theme }) => theme.spacing.sm};
  border-bottom: 1px solid ${({ theme }) => theme.border.subtle};

  h5 {
    margin: 0 0 ${({ theme }) => theme.spacing.xs};
    font-family: ${({ theme }) => theme.font.family.display};
    font-size: ${({ theme }) => theme.font.sizes.xs};
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: ${({ theme }) => theme.text.secondary};
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: ${({ theme }) => theme.spacing.xs};
    align-items: center;
    margin-bottom: ${({ theme }) => theme.spacing.xxs};
    font-size: ${({ theme }) => theme.font.sizes.xs};
  }
  select,
  input[list] {
    font-family: inherit;
    font-size: ${({ theme }) => theme.font.sizes.xs};
    padding: 2px 6px;
    background: ${({ theme }) => theme.bg.surface};
    color: ${({ theme }) => theme.text.primary};
    border: 1px solid ${({ theme }) => theme.border.default};
    border-radius: ${({ theme }) => theme.radii.sm};
    min-width: 0;
  }
  select:focus-visible,
  input[list]:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
    border-color: ${({ theme }) => theme.border.focus};
  }
  .empty {
    font-size: ${({ theme }) => theme.font.sizes.xs};
    color: ${({ theme }) => theme.text.muted};
  }
  .toggle-row {
    display: flex;
    align-items: center;
    gap: ${({ theme }) => theme.spacing.xs};
    font-size: ${({ theme }) => theme.font.sizes.xs};
    margin-bottom: ${({ theme }) => theme.spacing.xxs};
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: ${({ theme }) => theme.radii.sm};
    flex-shrink: 0;
    border: 1px solid ${({ theme }) => theme.border.subtle};
  }
  .toggle-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

// Restore-list (Hidden / Collapsed) — a compact <ul> with one row per
// affected node: a label/id span on the left, a Restore/Expand button on
// the right. Empty state is a single muted line.
export const RestoreList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: ${({ theme }) => theme.spacing.xs};
    align-items: center;
    margin-bottom: ${({ theme }) => theme.spacing.xxs};
    font-size: ${({ theme }) => theme.font.sizes.xs};
  }
  .restore-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .restore-id {
    color: ${({ theme }) => theme.text.muted};
    font-family: ${({ theme }) => theme.font.family.mono};
  }
  button {
    font-family: inherit;
    font-size: ${({ theme }) => theme.font.sizes.xs};
    padding: 1px 6px;
    color: ${({ theme }) => theme.text.primary};
    background: ${({ theme }) => theme.bg.canvas};
    border: 1px solid ${({ theme }) => theme.border.default};
    border-radius: ${({ theme }) => theme.radii.sm};
    cursor: pointer;
  }
  button:hover {
    border-color: ${({ theme }) => theme.border.strong};
    background: ${({ theme }) => theme.bg.subtle};
  }
  button:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`
