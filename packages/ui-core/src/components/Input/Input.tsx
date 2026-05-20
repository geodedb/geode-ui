import React from 'react'
import styled, { css } from 'styled-components'

import type { Theme } from '../../theme'

export type InputSize = 'sm' | 'md' | 'lg'

interface SizingProps {
  $size: InputSize
  $invalid: boolean
}

interface BorderArgs {
  theme: Theme
  $invalid: boolean
}

function borderColor({ theme, $invalid }: BorderArgs): string {
  return $invalid ? theme.colors.danger : theme.border.default
}

function focusBorderColor({ theme, $invalid }: BorderArgs): string {
  return $invalid ? theme.colors.danger : theme.border.focus
}

function focusShadow({ theme, $invalid }: BorderArgs): string {
  return $invalid ? theme.shadows.danger : theme.shadows.focus
}

const sizing = {
  sm: css`
    min-height: 32px;
    padding: 4px 10px;
    font-size: ${({ theme }) => theme.font.sizes.sm};
  `,
  md: css`
    min-height: ${({ theme }) => theme.touchTargets.min}px;
    padding: 8px 12px;
    font-size: ${({ theme }) => theme.font.sizes.md};
  `,
  lg: css`
    min-height: ${({ theme }) => theme.touchTargets.comfortable}px;
    padding: 12px 14px;
    font-size: ${({ theme }) => theme.font.sizes.lg};
  `,
}

const baseControl = css<SizingProps>`
  display: block;
  width: 100%;
  font-family: inherit;
  background: ${({ theme }) => theme.bg.surface};
  color: ${({ theme }) => theme.text.primary};
  border: 1px solid ${borderColor};
  border-radius: ${({ theme }) => theme.radii.md};
  transition:
    border-color ${({ theme }) => theme.transitions.fast}
      ${({ theme }) => theme.transitions.easing},
    box-shadow ${({ theme }) => theme.transitions.fast}
      ${({ theme }) => theme.transitions.easing};

  ${({ $size }) => sizing[$size]}

  &::placeholder {
    color: ${({ theme }) => theme.text.muted};
  }

  &:hover:not(:disabled):not(:focus-visible) {
    border-color: ${({ theme }) => theme.border.strong};
  }

  &:focus-visible {
    outline: none;
    border-color: ${focusBorderColor};
    box-shadow: ${focusShadow};
  }

  &:disabled {
    background: ${({ theme }) => theme.bg.subtle};
    color: ${({ theme }) => theme.text.muted};
    cursor: not-allowed;
  }
`

const StyledInput = styled.input<SizingProps>`
  ${baseControl}
`

const StyledTextarea = styled.textarea<SizingProps>`
  ${baseControl}
  min-height: 88px;
  resize: vertical;
  line-height: ${({ theme }) => theme.font.lineHeights.normal};
`

const StyledSelect = styled.select<SizingProps>`
  ${baseControl}
  appearance: none;
  /* Inline brand-purple chevron via data URI so the select renders the
   * same in Electron's file:// origin without external assets. */
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='none' stroke='%23601ca0' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round' d='M2.5 4.5l3.5 3.5 3.5-3.5'/></svg>");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
`

export interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'size'
> {
  inputSize?: InputSize
  invalid?: boolean
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ inputSize = 'md', invalid = false, ...rest }, ref) => {
    return (
      <StyledInput
        ref={ref}
        $size={inputSize}
        $invalid={invalid}
        aria-invalid={invalid || undefined}
        {...rest}
      />
    )
  }
)

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  inputSize?: InputSize
  invalid?: boolean
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ inputSize = 'md', invalid = false, ...rest }, ref) => {
    return (
      <StyledTextarea
        ref={ref}
        $size={inputSize}
        $invalid={invalid}
        aria-invalid={invalid || undefined}
        {...rest}
      />
    )
  }
)

export interface SelectProps extends Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  'size'
> {
  inputSize?: InputSize
  invalid?: boolean
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ inputSize = 'md', invalid = false, children, ...rest }, ref) => {
    return (
      <StyledSelect
        ref={ref}
        $size={inputSize}
        $invalid={invalid}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {children}
      </StyledSelect>
    )
  }
)
