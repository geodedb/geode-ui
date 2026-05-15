// Web Awesome ships its components as custom elements (web components).
// TypeScript's JSX intrinsic-element catalogue doesn't know about them
// out of the box. This file declares the specific tags we use so TSX
// authors can write <wa-button> without a TS error.
//
// As more components are adopted in follow-up migration plans, add
// their tag names + prop shapes here. Keep prop types loose (any
// HTML attribute, plus the WA-specific ones we actually use) — the
// upstream package exports stronger types via @awesome.me/webawesome
// but they require React 19 wrappers. We're React 18.

import type { HTMLAttributes, MouseEventHandler, ReactNode } from 'react'

type WaButtonProps = HTMLAttributes<HTMLElement> & {
  appearance?: 'filled' | 'outlined' | 'plain'
  size?: 'small' | 'medium' | 'large'
  variant?: 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'neutral'
  disabled?: boolean
  loading?: boolean
  pill?: boolean
  'aria-pressed'?: boolean | 'true' | 'false'
  onClick?: MouseEventHandler<HTMLElement>
  children?: ReactNode
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'wa-button': WaButtonProps
    }
  }
}

export {}
