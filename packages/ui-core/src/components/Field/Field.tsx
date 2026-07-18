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
  required,
  children,
}) => {
  // The hint <div> below only renders when hint && !error (error takes
  // visual precedence) — hintId must track that same condition, or
  // aria-describedby can reference an id with no corresponding DOM
  // node whenever both hint and error are supplied simultaneously.
  const showHint = Boolean(hint) && !error
  const errorId = error && htmlFor ? `${htmlFor}-error` : undefined
  const hintId = showHint && htmlFor ? `${htmlFor}-hint` : undefined

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
      <label htmlFor={htmlFor} className="small fw-medium text-body">
        {label}
      </label>
      {/* The required indicator is painted INLINE with the input row
          (not the label) per the user-facing convention of
          asterisk-next-to-the-field. wa-input's shadow `::after`
          asterisk is suppressed via the `--wa-form-control-required-
          content: ''` override in theme-bridge.ts, so we don't show a
          duplicate. The Bootstrap utility classes drive layout +
          color (red) and track theme tokens through the bridge. */}
      {required ? (
        <div className="d-flex align-items-center gap-2">
          <div className="flex-grow-1">{control}</div>
          <span
            aria-hidden="true"
            className="text-danger fw-bold"
            style={{ fontSize: '1.1em', lineHeight: 1 }}
          >
            *
          </span>
        </div>
      ) : (
        control
      )}
      {showHint && (
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
