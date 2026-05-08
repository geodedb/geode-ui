import React from 'react'
import styled from 'styled-components'

export interface FieldProps {
  label: React.ReactNode
  htmlFor?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  children: React.ReactNode
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const LabelText = styled.label`
  font-size: ${({ theme }) => theme.font.sizes.sm};
  font-weight: ${({ theme }) => theme.font.weights.medium};
  color: ${({ theme }) => theme.text.primary};
`

const Required = styled.span`
  color: ${({ theme }) => theme.colors.danger};
  margin-left: 2px;
`

const Hint = styled.div`
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.muted};
`

const ErrorText = styled.div`
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.danger};
`

// Field — wraps a control with its label, hint, and error text. The
// `htmlFor` prop binds the label to the underlying control via id;
// when omitted, the label still labels the visible control via DOM
// proximity but assistive tech may need an explicit linkage.
export const Field: React.FC<FieldProps> = ({
  label,
  htmlFor,
  hint,
  error,
  required,
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
    <Wrap>
      <LabelText htmlFor={htmlFor}>
        {label}
        {required && <Required aria-hidden="true">*</Required>}
      </LabelText>
      {control}
      {hint && !error && <Hint id={hintId}>{hint}</Hint>}
      {error && (
        <ErrorText id={errorId} role="alert">
          {error}
        </ErrorText>
      )}
    </Wrap>
  )
}
