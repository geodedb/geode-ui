// Geode UI primitives — single source of truth for visual components.
//
// Every page should compose its UI from these primitives rather than
// styled.button / styled.table / styled.label. New components added
// here should:
//   1. Forward refs and accept native HTML attributes.
//   2. Drive sizing/colors from theme tokens (no hex literals).
//   3. Honor prefers-reduced-motion for any animation.
//   4. Meet WCAG 2.5.5 touch-target minimums (theme.touchTargets.min).

export { Button } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'

export { Input, Textarea, Select } from './Input'
export type { InputProps, TextareaProps, SelectProps, InputSize } from './Input'

export { Field } from './Field'
export type { FieldProps } from './Field'

export { Stack, Inline, Container, Grid, Spacer } from './Stack'

export { Card, CardHeader, CardTitle, CardSubtitle } from './Card'

export { DataTable, TableScroll, EmptyCell } from './DataTable'

export { Modal, ConfirmModal } from './Modal'
export type { ModalProps, ConfirmModalProps } from './Modal'

export { Logo } from './Logo'
export type { LogoProps } from './Logo'

export { Icon } from './Icon'
export type { IconProps, IconStyle } from './Icon'
