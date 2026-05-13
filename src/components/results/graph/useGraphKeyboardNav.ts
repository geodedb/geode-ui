import { useCallback, useRef } from 'react'

export type UseGraphKeyboardNavArgs = {
  // The id of the currently-selected node (drives Enter → expand). Null
  // when nothing is selected.
  selectedId: string | null
  // 1-hop neighbour ids of the selected node, in the order the inspector
  // displays them. Tab / Shift+Tab / Arrow keys walk this array.
  neighborIds: string[]
  // Jump selection to this neighbour id.
  onJump: (id: string) => void
  // Trigger the expand-popover for this id (Enter).
  onExpand: (id: string) => void
}

export type UseGraphKeyboardNavResult = {
  // Bind to onKeyDown on the canvas (or any element that gets focus).
  handleKey: (e: KeyboardEvent | React.KeyboardEvent) => void
}

// Walk neighbours with Tab / Shift+Tab. The cursor starts at -1 (no
// step taken); the first Tab advances to neighbor[0]; subsequent Tabs
// walk forward modulo len; Shift+Tab walks backward modulo len. Enter
// fires onExpand on the currently-selected node (NOT a neighbour at
// cursor). ArrowRight / ArrowLeft are aliases for Tab / Shift+Tab so
// the canvas reads naturally for users not used to Tab-as-walk. Escape
// is the focus-escape hatch — because Tab is hijacked to walk
// neighbours, a keyboard-only user could otherwise be trapped on the
// canvas. Pressing Escape blurs the focused element (releasing focus
// back to the browser's normal Tab order on the next keypress) and
// resets the internal cursor to -1 so the next Tab restarts from
// neighbor[0]. Escape does NOT call preventDefault (its default is a
// no-op anyway, and we want browser-native Escape behavior to apply
// to anything else listening).
export function useGraphKeyboardNav(
  args: UseGraphKeyboardNavArgs
): UseGraphKeyboardNavResult {
  const { selectedId, neighborIds, onJump, onExpand } = args
  const cursorRef = useRef<number>(-1)
  // Reset cursor whenever the selection changes — if the user clicked a
  // different node, the next Tab should start fresh.
  if (cursorRef.current >= 0) {
    const last = neighborIds[cursorRef.current]
    if (selectedId !== last) cursorRef.current = -1
  }

  const handleKey = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent): void => {
      const isTab = e.key === 'Tab'
      const isArrowFwd = e.key === 'ArrowRight'
      const isArrowBack = e.key === 'ArrowLeft'
      const isEnter = e.key === 'Enter'
      const isEscape = e.key === 'Escape'
      if (!isTab && !isArrowFwd && !isArrowBack && !isEnter && !isEscape) {
        return
      }
      if (isEscape) {
        // Focus-escape hatch: blur the canvas and reset the cursor so
        // the next Tab restarts from neighbor[0]. Guard against test
        // events that lack currentTarget.
        cursorRef.current = -1
        const raw = (e as { currentTarget?: unknown }).currentTarget
        const target = raw as HTMLElement | null | undefined
        if (target && typeof target.blur === 'function') {
          target.blur()
        }
        return
      }
      if (isEnter) {
        if (selectedId) {
          e.preventDefault()
          onExpand(selectedId)
        }
        return
      }
      if (neighborIds.length === 0) return
      e.preventDefault()
      const backward = (isTab && e.shiftKey) || isArrowBack
      const len = neighborIds.length
      const next = backward
        ? (cursorRef.current - 1 + len) % len
        : (cursorRef.current + 1 + len) % len
      cursorRef.current = next
      onJump(neighborIds[next] as string)
    },
    [neighborIds, onExpand, onJump, selectedId]
  )

  return { handleKey }
}
