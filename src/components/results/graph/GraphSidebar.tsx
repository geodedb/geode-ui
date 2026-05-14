import React from 'react'
import styled from 'styled-components'

const Side = styled.aside<{ $height?: number; $fill: boolean }>`
  /* In fill mode the sidebar flexes to fill its grid track (the Wrap's
     height: 100% cascades down) and scrolls internally; otherwise it
     matches the caller-provided canvas height for the side-by-side
     layout. The $height value is ignored in fill mode. */
  ${({ $height, $fill }) => {
    if ($fill) {
      return `
        height: 100%;
        min-height: 0;
      `
    }
    return `height: ${$height ?? 480}px;`
  }}
  overflow: auto;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.bg.surface};
  color: ${({ theme }) => theme.text.primary};

  pre {
    white-space: pre-wrap;
    word-break: break-all;
  }

  /* Below the md breakpoint the sidebar follows the canvas in stacked
     order; cap its height so a long property dump doesn't push the
     editor and the rest of the page off-screen on phone form factors. */
  @media (max-width: ${({ theme }) => theme.breakpoints.md - 0.02}px) {
    height: auto;
    max-height: 320px;
  }
`

export type GraphSidebarProps = {
  // Pixel height the sidebar tracks in side-by-side mode. In fill mode
  // this value is ignored — the sidebar flexes to fill the grid track.
  height?: number
  // When true the sidebar fills its grid track inside the maximized
  // overlay (the parent Wrap has `height: 100%`). Drives the height
  // treatment described above.
  fill: boolean
  // Inspector + controls — rendered inside the scrollable Side.
  children: React.ReactNode
}

// GraphSidebar is the responsive sidebar wrapper that holds the graph's
// inspector and control blocks (visibility, selection, display, hidden
// / collapsed lists, selected-element inspector). It is the
// `data-testid="graph-sidebar"` element the test suite asserts against.
// The orchestrator (GraphView) handles the collapsed-state guard — when
// the sidebar is collapsed the orchestrator simply doesn't render this
// component.
export const GraphSidebar: React.FC<GraphSidebarProps> = ({
  height,
  fill,
  children,
}) => {
  return (
    <Side data-testid="graph-sidebar" $height={height} $fill={fill}>
      {children}
    </Side>
  )
}
