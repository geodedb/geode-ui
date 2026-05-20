import React from 'react'
import styled from 'styled-components'

import { Icon } from '@geodedb/ui-core'

// Side is the responsive sidebar wrapper that holds the graph's
// inspector and control blocks. Always fills its grid track in the
// side-by-side layout; caps its height below the md breakpoint where
// the grid stacks the sidebar under the canvas.
const Side = styled.aside`
  height: 100%;
  min-height: 0;
  /* Bug 3: overflow:auto (shorthand) lets a child wider than the
     sidebar produce a horizontal scrollbar. The sidebar's children
     are select boxes, toggle rows, and the inspector property list —
     all of which CAN exceed the 300 px column width when a label or
     value is long. Constrain to vertical scroll only and let the
     inner content wrap or truncate (the .toggle-label rule in
     styled.ts ControlsBlock already sets text-overflow: ellipsis on
     the visibility row labels). */
  overflow-x: hidden;
  overflow-y: auto;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.bg.surface};
  color: ${({ theme }) => theme.text.primary};
  /* Position-relative anchors the in-sidebar collapse button so it
     stays pinned to the sidebar's top-right corner regardless of how
     much the inspector content has scrolled. */
  position: relative;

  pre {
    white-space: pre-wrap;
    word-break: break-all;
  }

  @media (max-width: ${({ theme }) => theme.breakpoints.md - 0.02}px) {
    height: auto;
    max-height: 320px;
  }
`

const CollapseBtn = styled.button`
  /* Bug 2: desktop users had no way to collapse the sidebar from
     inside the sidebar — the only path was the GraphToolbarMore
     dropdown item, which is buried and hard to discover. Render a
     ✕-style button pinned to the sidebar's top-right corner so the
     close affordance is always one click away. The mobile toolbar
     button remains the canonical mobile path. */
  position: sticky;
  /* Sticky top so the button stays visible while the user scrolls the
     inspector. The negative margin tucks it into the sidebar padding
     edge so it doesn't shift content. */
  top: 0;
  margin-left: auto;
  display: block;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.bg.canvas};
  color: ${({ theme }) => theme.text.secondary};
  width: 24px;
  height: 24px;
  padding: 0;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  /* Float above the inspector content so it stays clickable even when
     the section header sits at the very top of the viewport. */
  z-index: 1;

  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
    color: ${({ theme }) => theme.text.primary};
  }

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

export type GraphSidebarProps = {
  // Inspector + controls — rendered inside the scrollable Side.
  children: React.ReactNode
  // When provided, an in-sidebar collapse button is rendered top-right.
  // Optional so the component stays usable in contexts (tests, future
  // sidebar embeddings) that don't manage a collapsed state.
  onCollapse?: () => void
  // Localised aria-label for the collapse button. Required when
  // onCollapse is provided.
  collapseLabel?: string
}

// GraphSidebar is the responsive sidebar wrapper that holds the graph's
// inspector and control blocks (visibility, selection, display, hidden
// / collapsed lists, selected-element inspector). The orchestrator
// (GraphView) handles the collapsed-state guard — when the sidebar is
// collapsed the orchestrator simply doesn't render this component.
export const GraphSidebar: React.FC<GraphSidebarProps> = ({
  children,
  onCollapse,
  collapseLabel,
}) => {
  return (
    <Side data-testid="graph-sidebar">
      {onCollapse && (
        <CollapseBtn
          type="button"
          data-testid="graph-sidebar-collapse-btn"
          aria-label={collapseLabel ?? 'Collapse sidebar'}
          title={collapseLabel ?? 'Collapse sidebar'}
          onClick={onCollapse}
        >
          <Icon name="xmark" />
        </CollapseBtn>
      )}
      {children}
    </Side>
  )
}
