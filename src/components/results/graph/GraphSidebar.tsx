import React from 'react'
import styled from 'styled-components'

// Side is the responsive sidebar wrapper that holds the graph's
// inspector and control blocks. Always fills its grid track in the
// side-by-side layout; caps its height below the md breakpoint where
// the grid stacks the sidebar under the canvas.
const Side = styled.aside`
  height: 100%;
  min-height: 0;
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

  @media (max-width: ${({ theme }) => theme.breakpoints.md - 0.02}px) {
    height: auto;
    max-height: 320px;
  }
`

export type GraphSidebarProps = {
  // Inspector + controls — rendered inside the scrollable Side.
  children: React.ReactNode
}

// GraphSidebar is the responsive sidebar wrapper that holds the graph's
// inspector and control blocks (visibility, selection, display, hidden
// / collapsed lists, selected-element inspector). The orchestrator
// (GraphView) handles the collapsed-state guard — when the sidebar is
// collapsed the orchestrator simply doesn't render this component.
export const GraphSidebar: React.FC<GraphSidebarProps> = ({ children }) => {
  return <Side data-testid="graph-sidebar">{children}</Side>
}
