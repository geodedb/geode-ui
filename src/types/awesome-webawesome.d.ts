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

type WaInputProps = HTMLAttributes<HTMLElement> & {
  type?: 'text' | 'password' | 'email' | 'search' | 'number' | 'tel' | 'url'
  value?: string
  defaultValue?: string
  label?: string
  placeholder?: string
  size?: 'small' | 'medium' | 'large'
  appearance?: 'filled' | 'outlined'
  disabled?: boolean
  required?: boolean
  hint?: string
  pill?: boolean
  clearable?: boolean
  min?: number | string
  max?: number | string
  children?: ReactNode
}

type WaSelectProps = HTMLAttributes<HTMLElement> & {
  value?: string
  defaultValue?: string
  label?: string
  placeholder?: string
  size?: 'small' | 'medium' | 'large'
  appearance?: 'filled' | 'outlined'
  disabled?: boolean
  pill?: boolean
  children?: ReactNode
}

type WaOptionProps = HTMLAttributes<HTMLElement> & {
  value?: string
  disabled?: boolean
  children?: ReactNode
}

type WaDialogProps = HTMLAttributes<HTMLElement> & {
  open?: boolean
  label?: string
  children?: ReactNode
}

type WaTabGroupProps = HTMLAttributes<HTMLElement> & {
  active?: string
  placement?: 'top' | 'bottom' | 'start' | 'end'
  children?: ReactNode
}

type WaTabProps = HTMLAttributes<HTMLElement> & {
  panel?: string
  active?: boolean
  closable?: boolean
  disabled?: boolean
  slot?: string
  children?: ReactNode
}

type WaTabPanelProps = HTMLAttributes<HTMLElement> & {
  name?: string
  children?: ReactNode
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'wa-button': WaButtonProps
      'wa-input': WaInputProps
      'wa-select': WaSelectProps
      'wa-option': WaOptionProps
      'wa-dialog': WaDialogProps
      'wa-tab-group': WaTabGroupProps
      'wa-tab': WaTabProps
      'wa-tab-panel': WaTabPanelProps
    }
  }
}

export {}
