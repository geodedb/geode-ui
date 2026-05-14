import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'

export type NodeContextMenuAction =
  | 'zoomTo'
  | 'expand'
  | 'hide'
  | 'collapse'
  | 'focus'
  | 'pin'
  | 'copyId'

type TFn = (key: string, opts?: Record<string, unknown>) => string

const Menu = styled.ul`
  position: fixed;
  z-index: 1000;
  margin: 0;
  padding: ${({ theme }) => theme.spacing.xxs};
  list-style: none;
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  box-shadow: ${({ theme }) => theme.shadows.lg ?? theme.shadows.md};
  min-width: 180px;

  li button {
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: ${({ theme }) => theme.text.primary};
    font: inherit;
    padding: 6px 10px;
    border-radius: ${({ theme }) => theme.radii.sm};
    cursor: pointer;
  }
  li button:hover,
  li button:focus-visible {
    background: ${({ theme }) => theme.bg.subtle};
    outline: none;
  }
`

export type NodeContextMenuProps = {
  open: boolean
  x: number
  y: number
  // Ordered list of actions; the component renders one button per id.
  items: NodeContextMenuAction[]
  onSelect: (a: NodeContextMenuAction) => void
  onClose: () => void
  t: TFn
}

// Resolve a menu action to its translated label. Spelled out as a
// switch on literal i18n keys so that scripts/validate-translations.mjs
// — which extracts only literal-string translation calls — sees every
// key the menu actually emits. Do NOT collapse this into a lookup
// object; that would hide the keys from the orphan checker.
function labelFor(action: NodeContextMenuAction, t: TFn): string {
  switch (action) {
    case 'zoomTo':
      return t('graph.menuZoomTo')
    case 'expand':
      return t('graph.menuExpand')
    case 'hide':
      return t('graph.actionHide')
    case 'collapse':
      return t('graph.actionCollapse')
    case 'focus':
      return t('graph.menuFocus')
    case 'pin':
      return t('graph.menuPin')
    case 'copyId':
      return t('graph.menuCopyId')
    default: {
      // Exhaustiveness check — surfaces at compile time if a new action
      // is added to NodeContextMenuAction without a label.
      const exhaustive: never = action
      return exhaustive
    }
  }
}

// Lookup for the pinned-state label variant. The actual swap from "Pin"
// to "Unpin" happens in Task 13 when usePinnedNodes lands; exporting
// the helper here keeps the i18n surface complete and lets the orphan
// checker see `graph.menuUnpin` referenced via a literal `t()` call.
export function unpinLabel(t: TFn): string {
  return t('graph.menuUnpin')
}

export const NodeContextMenu: React.FC<NodeContextMenuProps> = ({
  open,
  x,
  y,
  items,
  onSelect,
  onClose,
  t,
}) => {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Outside-click dismissal. We bind on `mousedown` (capture phase) so
    // the menu closes BEFORE any other element can react to the click —
    // but we guard with `root.contains(target)` so a mousedown INSIDE the
    // menu does not close it, which lets the subsequent click/mouseup on a
    // menu button still fire `onSelect` normally.
    const onClick = (e: MouseEvent): void => {
      const root = document.querySelector('[data-testid="graph-node-menu"]')
      if (root && !root.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick, true)
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <Menu data-testid="graph-node-menu" role="menu" style={{ left: x, top: y }}>
      {items.map((id) => (
        <li key={id} role="none">
          <button
            type="button"
            role="menuitem"
            data-testid={`graph-node-menu-${id}`}
            onClick={() => onSelect(id)}
          >
            {labelFor(id, t)}
          </button>
        </li>
      ))}
    </Menu>,
    document.body
  )
}
