import styled from 'styled-components'

// Wrap is the grid container for the graph view. Always fills its
// parent's content box (the QueryPage result region). The side-by-
// side 1fr/300px layout — and its below-md stacked fallback — is the
// only layout mode. When the sidebar is collapsed the grid becomes
// a single 1fr column.
export const Wrap = styled.div<{ $sidebarCollapsed: boolean }>`
  display: grid;
  grid-template-columns: ${({ $sidebarCollapsed }) => {
    return $sidebarCollapsed ? '1fr' : '1fr 300px'
  }};
  gap: ${({ theme }) => theme.spacing.sm};
  flex: 1 1 0;
  min-height: 0;

  @media (max-width: ${({ theme }) => theme.breakpoints.md - 0.02}px) {
    grid-template-columns: 1fr;
  }
`

// CanvasArea holds the Cytoscape canvas plus any absolutely-positioned
// overlays. Position-relative so the overlay can stack on top of the
// canvas without entering Cytoscape's internal DOM tree. `min-width: 0`
// lets this `1fr` grid track shrink below the intrinsic width of the
// Cytoscape <canvas>. `height: 100%; min-height: 0` lets it flex-shrink
// inside Wrap so the Canvas (`flex: 1 1 auto`) actually claims the
// remaining vertical space below the toolbar.
export const CanvasArea = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  gap: ${({ theme }) => theme.spacing.xs};
`

// Canvas renders the Cytoscape <canvas> host. Always flexes to fill
// its CanvasArea parent; the cytoscape ResizeObserver re-fits the graph
// on container resize. At mobile widths the Wrap collapses to a single
// grid column (CanvasArea stacks above Sidebar with auto rows), so the
// flex chain loses its positive parent height — without a mobile
// min-height the canvas would collapse to 0 px and the graph would be
// invisible behind the toolbar.
//
// The min-height is clamped to `min(60dvh, calc(100dvh - 360px))` so the
// canvas never grows taller than the viewport minus the editor + toolbar
// chrome above it (~360 px after Fix #1 shrinks the editor). `dvh`
// accounts for the iOS Safari URL bar; the absolute 240 px floor keeps
// the canvas usable when the viewport-minus-chrome calculation would
// otherwise drive it negative. Above the md breakpoint the canvas reverts
// to pure flex-fill since the side-by-side grid supplies its height
// through the parent flex chain.
export const Canvas = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  background: ${({ theme }) => theme.bg.graphCanvas};

  @media (max-width: ${({ theme }) => theme.breakpoints.md - 0.02}px) {
    /* Fallback for browsers without dvh support (< Safari 15.4). */
    min-height: 240px;
    /* dvh-aware clamp: never taller than viewport minus the editor +
       Bar chrome above us, never shorter than the 240 px floor (max())
       so the graph stays usable even on a 568 px tall portrait viewport
       where calc(100dvh - 360px) = 208 px. */
    min-height: max(240px, min(60dvh, calc(100dvh - 360px)));
    /* Cap the canvas at the same dvh budget so the wa-tab-panel /
       wa-tab-group flex chain (which now propagates the full result
       region height into the panel — see ResultPanel.tsx) cannot grow
       the canvas past the visible viewport. Bug 2 regression on
       375×812 mobile: without max-height the canvas inherits ~700 px
       of available flex space and pushes its lower edge off-screen. */
    max-height: max(240px, calc(100dvh - 360px));
  }
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
