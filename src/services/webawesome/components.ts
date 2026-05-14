// React adapter wrappers for the Web Awesome components that fire
// CUSTOM EVENTS. React 18 doesn't forward `onWaChange={...}` props
// for unknown events on bare custom elements, so we use
// @lit/react's createComponent to map each WA custom event to a
// matching `onWaXxx` / `onXxx` React prop.
//
// Buttons are intentionally NOT wrapped — they fire standard
// `click`, which React forwards natively via `onClick`. Consumers
// can use `<wa-button onClick={handler}>` directly.
//
// Event names below were verified against the component `.d.ts`
// files in @awesome.me/webawesome. Input/Select fire STANDARD-
// named events (`change`, `input`, `focus`, `blur`) plus a few
// `wa-*` events (`wa-clear`, `wa-invalid`). Dialog/TabGroup/Tab
// fire only `wa-*` events.

import * as React from 'react'
// `@lit/react` is intentionally not in package.json — it ships as a
// direct dep of `@awesome.me/webawesome` (see node_modules/.../package.json)
// and is the supported integration path WA itself documents. Re-listing
// it as a top-level dep would risk a version skew with WA's pinned
// `@lit/react`. The eslint rule below is disabled per the migration
// plan's "no new dependencies" constraint.
// eslint-disable-next-line import/no-extraneous-dependencies
import { createComponent } from '@lit/react'

import WaInput from '@awesome.me/webawesome/dist/components/input/input.js'
import WaSelect from '@awesome.me/webawesome/dist/components/select/select.js'
import WaOption from '@awesome.me/webawesome/dist/components/option/option.js'
import WaDialog from '@awesome.me/webawesome/dist/components/dialog/dialog.js'
import WaTabGroup from '@awesome.me/webawesome/dist/components/tab-group/tab-group.js'
import WaTab from '@awesome.me/webawesome/dist/components/tab/tab.js'
import WaTabPanel from '@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js'

// Extra prop shapes for the WA input element. Same rationale as the
// TabGroup/Tab/TabPanel wrappers below: `elementClass: ... as never`
// erases element-specific props from @lit/react's inferred shape, so
// the wrapper exposes only base HTMLAttributes. Hoist the WA-specific
// props (and the controlled-input `value`) back in here so call sites
// can write `<Input value={x} onInput={...} type="password" required />`.
type InputExtraProps = {
  type?:
    | 'text'
    | 'password'
    | 'email'
    | 'search'
    | 'number'
    | 'tel'
    | 'url'
    | 'date'
    | 'datetime-local'
    | 'time'
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
  autoComplete?: string
  name?: string
}

export const Input = createComponent({
  tagName: 'wa-input',
  elementClass: WaInput as never,
  react: React,
  events: {
    onChange: 'change',
    onInput: 'input',
    onBlur: 'blur',
    onFocus: 'focus',
    onWaClear: 'wa-clear',
    onWaInvalid: 'wa-invalid',
  },
}) as unknown as React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLElement> &
    InputExtraProps & {
      onChange?: (e: Event) => void
      onInput?: (e: Event) => void
      onBlur?: (e: Event) => void
      onFocus?: (e: Event) => void
      onWaClear?: (e: Event) => void
      onWaInvalid?: (e: Event) => void
    } & React.RefAttributes<HTMLElement>
>

export const Select = createComponent({
  tagName: 'wa-select',
  elementClass: WaSelect as never,
  react: React,
  events: {
    onChange: 'change',
    onInput: 'input',
    onBlur: 'blur',
    onFocus: 'focus',
    onWaClear: 'wa-clear',
    onWaShow: 'wa-show',
    onWaAfterShow: 'wa-after-show',
    onWaHide: 'wa-hide',
    onWaAfterHide: 'wa-after-hide',
    onWaInvalid: 'wa-invalid',
  },
})

export const Option = createComponent({
  tagName: 'wa-option',
  elementClass: WaOption as never,
  react: React,
  events: {},
})

export const Dialog = createComponent({
  tagName: 'wa-dialog',
  elementClass: WaDialog as never,
  react: React,
  events: {
    onWaShow: 'wa-show',
    onWaAfterShow: 'wa-after-show',
    onWaHide: 'wa-hide',
    onWaAfterHide: 'wa-after-hide',
  },
})

// Extra prop shapes for the WA tab elements. We hand-roll these on top
// of the @lit/react wrappers because we pass `elementClass: ... as never`
// (the WA classes import Lit decorators that confuse TS's class-shape
// inference). Without the cast the wrapper carries `Partial<{}>` for
// the element-specific props — these unions add them back so call sites
// can write `<TabGroup active="json">`, `<Tab panel="json">`, etc.
type TabGroupExtraProps = {
  active?: string
  placement?: 'top' | 'bottom' | 'start' | 'end'
  activation?: 'auto' | 'manual'
  onWaTabShow?: (e: Event) => void
  onWaTabHide?: (e: Event) => void
}

type TabExtraProps = {
  panel?: string
  active?: boolean
  closable?: boolean
  disabled?: boolean
  slot?: string
}

type TabPanelExtraProps = {
  name?: string
  active?: boolean
}

export const TabGroup = createComponent({
  tagName: 'wa-tab-group',
  elementClass: WaTabGroup as never,
  react: React,
  events: {
    onWaTabShow: 'wa-tab-show',
    onWaTabHide: 'wa-tab-hide',
  },
}) as unknown as React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLElement> &
    TabGroupExtraProps &
    React.RefAttributes<HTMLElement>
>

export const Tab = createComponent({
  tagName: 'wa-tab',
  elementClass: WaTab as never,
  react: React,
  events: {},
}) as unknown as React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLElement> &
    TabExtraProps &
    React.RefAttributes<HTMLElement>
>

export const TabPanel = createComponent({
  tagName: 'wa-tab-panel',
  elementClass: WaTabPanel as never,
  react: React,
  events: {},
}) as unknown as React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLElement> &
    TabPanelExtraProps &
    React.RefAttributes<HTMLElement>
>
