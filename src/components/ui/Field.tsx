import React from 'react'

export interface FieldProps {
  label: React.ReactNode
  htmlFor?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  children: React.ReactNode
}

// Field — wraps a control with its label, hint, and error text. The
// `htmlFor` prop binds the label to the underlying control via id;
// when omitted, the label still labels the visible control via DOM
// proximity but assistive tech may need an explicit linkage.
//
// Migrated to Bootstrap utilities per BOOTSTRAP_MIGRATION.md.
// theme-bridge.ts emits `--bs-*` variables sourced from the active
// theme, so `text-body`, `text-body-tertiary`, `text-danger`, and
// `small` track theme tokens through the bridge.
//
// theme token → Bootstrap class:
//   spacing 6px gap         → gap-1 (4px; close enough — was 6px ad hoc)
//   text.primary + weight   → text-body fw-medium
//   text.muted              → text-body-tertiary
//   text.danger             → text-danger
//   font.sizes.sm           → small
//   font.sizes.xs           → small (Bootstrap's `.small` is 0.875em; xs is 12px)
export const Field: React.FC<FieldProps> = ({
  label,
  htmlFor,
  hint,
  error,
  // `required` is retained on the prop type for source-level
  // compatibility (callers pass it; future non-wa controls might
  // re-introduce a Field-side asterisk indicator). For now the
  // visual cue comes from the wa-* control's shadow ::after rule,
  // so the prop is intentionally unused here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  required: _required,
  children,
}) => {
  const errorId = error && htmlFor ? `${htmlFor}-error` : undefined
  const hintId = hint && htmlFor ? `${htmlFor}-hint` : undefined

  // Inject aria-describedby into the single child control if it's a
  // valid React element. Multi-control fields should pass it manually.
  let control = children
  if (
    React.isValidElement(children) &&
    (errorId || hintId) &&
    typeof (children as React.ReactElement).props === 'object'
  ) {
    const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
    const childProps = (children as React.ReactElement).props as Record<
      string,
      unknown
    >
    control = React.cloneElement(
      children as React.ReactElement,
      {
        'aria-describedby':
          [childProps['aria-describedby'] as string | undefined, describedBy]
            .filter(Boolean)
            .join(' ') || undefined,
      } as Partial<unknown>
    )
  }

  return (
    <div className="d-flex flex-column gap-1">
      {/* The asterisk indicator is rendered by the wa-* control's
          shadow-DOM `[part~='label']::after` rule (Web Awesome's
          form-control styles) when the control carries the `required`
          attribute. Field used to also paint an asterisk here, which
          produced a duplicate "*" next to every required wa-input on
          the login screen. Drop the local indicator — callers that
          want the visual cue should pass `required` to the wa-input
          itself (which we already do). */}
      <label htmlFor={htmlFor} className="small fw-medium text-body">
        {label}
      </label>
      {control}
      {hint && !error && (
        <div id={hintId} className="small text-body-tertiary">
          {hint}
        </div>
      )}
      {error && (
        <div id={errorId} role="alert" className="small text-danger">
          {error}
        </div>
      )}
    </div>
  )
}
