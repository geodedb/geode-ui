// Geode UI primitives — single source of truth for visual components.
//
// Every page should compose its UI from these primitives rather than
// styled.button / styled.table / styled.label. New components added
// here should:
//   1. Forward refs and accept native HTML attributes.
//   2. Drive sizing/colors from theme tokens (no hex literals).
//   3. Honor prefers-reduced-motion for any animation.
//   4. Meet WCAG 2.5.5 touch-target minimums (theme.touchTargets.min).

export { Button } from '@geodedb/ui-core'
export type { ButtonProps, ButtonVariant, ButtonSize } from '@geodedb/ui-core'

export { Input, Textarea, Select } from '@geodedb/ui-core'
export type {
  InputProps,
  TextareaProps,
  SelectProps,
  InputSize,
} from '@geodedb/ui-core'

export { Field } from '@geodedb/ui-core'
export type { FieldProps } from '@geodedb/ui-core'

export { Stack, Inline, Container, Grid, Spacer } from '@geodedb/ui-core'

export { Card, CardHeader, CardTitle, CardSubtitle } from '@geodedb/ui-core'

export { DedupedDatalist } from './DedupedDatalist'
export type { DedupedDatalistProps } from './DedupedDatalist'

export { DataTable, TableScroll, EmptyCell } from '@geodedb/ui-core'

export { Modal, ConfirmModal } from './Modal'
export type { ModalProps, ConfirmModalProps } from './Modal'

export { Logo } from './Logo'
export type { LogoProps } from './Logo'

export { Icon } from '@geodedb/ui-core'
export type { IconProps, IconStyle } from '@geodedb/ui-core'

export { useUniqueValues } from '@geodedb/ui-core'
