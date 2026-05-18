import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

// Headless Bootstrap 5.3 dropdown — wraps a trigger button and a
// dropdown-menu list with the canonical Bootstrap class names so the
// global stylesheet paints it consistently with the rest of the UI.
//
// We do NOT import bootstrap's JS module: Popper.js would land in the
// entry chunk and Bootstrap's data-bs-toggle initialiser races React's
// effect cycle in dev/HMR. A small controlled component is preferable:
// outside-click closes, Escape closes, keyboard arrows move focus,
// Enter/Space activates.
//
// Visually identical to a Bootstrap-JS-driven dropdown because all the
// CSS comes from the shared bootstrap.min.css + bootstrap-bridge.css
// pair imported at index.tsx. The bridge maps --bs-* tokens to the
// active theme so the dropdown inherits Web Awesome surface/text
// colors in both light and dark variants.

export interface BootstrapDropdownItem<T extends string> {
  value: T
  label: React.ReactNode
  disabled?: boolean
}

export interface BootstrapDropdownProps<T extends string> {
  items: ReadonlyArray<BootstrapDropdownItem<T>>
  value: T
  onChange: (next: T) => void
  // Visible button label. Defaults to the active item's label.
  triggerLabel?: React.ReactNode
  // Accessibility label used when the trigger renders only an icon.
  ariaLabel?: string
  // Width override (Bootstrap's default toggle hugs its content; tests
  // sometimes need a fixed width to compare against the legacy select).
  className?: string
  size?: 'sm' | 'md' | 'lg'
  // Forwarded onto the trigger <button> — test ids, data-* attrs, etc.
  // Use sparingly; prefer wrapping the component in a div with the
  // attribute if you need to mark the dropdown root.
  triggerProps?: Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'onClick' | 'aria-expanded' | 'aria-haspopup' | 'type' | 'className'
  > & {
    // Allow arbitrary data-* / aria-* attributes — TS lacks an index
    // signature for data-attribute literals, so spread surface them
    // here as an open map.
    [dataAttr: `data-${string}`]: string | number | boolean | undefined
    [ariaAttr: `aria-${string}`]: string | number | boolean | undefined
  }
}

export const BootstrapDropdown = <T extends string>({
  items,
  value,
  onChange,
  triggerLabel,
  ariaLabel,
  className,
  size = 'sm',
  triggerProps,
}: BootstrapDropdownProps<T>): React.ReactElement => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuId = useId()

  const active = items.find((i) => i.value === value)
  const label =
    triggerLabel !== undefined ? triggerLabel : (active?.label ?? value)

  const close = useCallback((restoreFocus: boolean): void => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  // Outside-click + Escape handlers, only mounted while the menu is open.
  useEffect(() => {
    if (!open) return undefined
    const onDocMouse = (e: MouseEvent): void => {
      const root = rootRef.current
      if (!root) return
      if (e.target instanceof Node && !root.contains(e.target)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(true)
      }
    }
    document.addEventListener('mousedown', onDocMouse)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouse)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  // When the menu opens, move focus to the active item so arrow keys
  // start from a sensible spot. Without this Bootstrap's CSS still
  // paints the menu but keyboard users land outside it.
  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    if (!menu) return
    const activeBtn = menu.querySelector<HTMLButtonElement>(
      '[data-active="true"]'
    )
    activeBtn?.focus()
  }, [open])

  const onMenuKey = (e: React.KeyboardEvent<HTMLUListElement>): void => {
    const menu = menuRef.current
    if (!menu) return
    const focusables = Array.from(
      menu.querySelectorAll<HTMLButtonElement>(
        'button.dropdown-item:not(:disabled)'
      )
    )
    if (focusables.length === 0) return
    const current = focusables.findIndex(
      (b) => b === (document.activeElement as HTMLElement | null)
    )
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = current < 0 ? 0 : (current + 1) % focusables.length
      focusables[next]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next =
        current < 0
          ? focusables.length - 1
          : (current - 1 + focusables.length) % focusables.length
      focusables[next]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusables[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      focusables[focusables.length - 1]?.focus()
    }
  }

  let sizeClass = ''
  if (size === 'lg') sizeClass = 'btn-lg'
  else if (size === 'sm') sizeClass = 'btn-sm'
  const rootClass = `dropdown ${className ?? ''}`.trim()

  // Anchor + width snapshot used to position the portaled menu. The
  // menu can't render inside .dropdown anymore (the GraphToolbar wraps
  // its row in `overflow-x: auto`, which on every modern browser
  // implies `overflow-y: auto` and clips an absolutely-positioned
  // child). Rendering the menu through createPortal to document.body
  // sidesteps every ancestor overflow rule.
  const [anchorRect, setAnchorRect] = useState<{
    left: number
    top: number
    minWidth: number
  } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setAnchorRect(null)
      return undefined
    }
    const measure = (): void => {
      const trigger = triggerRef.current
      if (!trigger) return
      const r = trigger.getBoundingClientRect()
      setAnchorRect({
        left: r.left,
        top: r.bottom + 2,
        minWidth: r.width,
      })
    }
    measure()
    // Re-measure on window resize / scroll so the menu stays anchored.
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])

  // Extract style into a const so the JSX ternary doesn't trip the
  // airbnb-vs-prettier indentation rules that fire when an object
  // literal sits inside an inline JSX prop ternary.
  let menuStyle: React.CSSProperties
  if (anchorRect) {
    menuStyle = {
      position: 'fixed',
      left: anchorRect.left,
      top: anchorRect.top,
      minWidth: anchorRect.minWidth,
      margin: 0,
      zIndex: 1050,
    }
  } else {
    menuStyle = { position: 'fixed', visibility: 'hidden' }
  }

  const menuContents = (
    <ul
      ref={menuRef}
      id={menuId}
      className={`dropdown-menu${open ? ' show' : ''}`}
      role="listbox"
      aria-label={ariaLabel}
      onKeyDown={onMenuKey}
      style={menuStyle}
    >
      {items.map((item) => {
        const isActive = item.value === value
        return (
          <li key={item.value}>
            <button
              type="button"
              role="option"
              aria-selected={isActive}
              data-active={isActive ? 'true' : 'false'}
              disabled={item.disabled}
              className={`dropdown-item ${isActive ? 'active' : ''}`.trim()}
              onClick={() => {
                onChange(item.value)
                close(true)
              }}
            >
              {item.label}
            </button>
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className={rootClass} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`btn btn-outline-secondary dropdown-toggle ${sizeClass}`.trim()}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={menuId}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        {...triggerProps}
      >
        {label}
      </button>
      {/* Portal the open menu to document.body so it escapes every
          ancestor overflow / clip / transform / z-index stacking
          context — the GraphToolbar's `overflow-x: auto` rule otherwise
          eats the menu (Bug 1: only the active item is visible) and
          forces the toolbar to grow a vertical scroll (Bug 4). When
          closed we keep the <ul> inline-hidden so listbox a11y still
          finds the controlled element via aria-controls. */}
      {open && typeof document !== 'undefined'
        ? createPortal(menuContents, document.body)
        : menuContents}
    </div>
  )
}
