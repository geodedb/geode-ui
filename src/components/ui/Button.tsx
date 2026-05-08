import React from 'react'
import styled, { css } from 'styled-components'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'type'
> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  loading?: boolean
  iconLeft?: React.ReactNode
  iconRight?: React.ReactNode
  type?: 'button' | 'submit' | 'reset'
}

const sizeStyles = {
  sm: css`
    min-height: 32px;
    padding: 4px 10px;
    font-size: ${({ theme }) => theme.font.sizes.sm};
    border-radius: ${({ theme }) => theme.radii.sm};
    gap: 6px;
  `,
  md: css`
    min-height: ${({ theme }) => theme.touchTargets.min}px;
    padding: 8px 16px;
    font-size: ${({ theme }) => theme.font.sizes.md};
    border-radius: ${({ theme }) => theme.radii.md};
    gap: 8px;
  `,
  lg: css`
    min-height: ${({ theme }) => theme.touchTargets.comfortable}px;
    padding: 12px 24px;
    font-size: ${({ theme }) => theme.font.sizes.lg};
    border-radius: ${({ theme }) => theme.radii.lg};
    gap: 10px;
  `,
}

const variantStyles = {
  primary: css`
    background: ${({ theme }) => theme.colors.primary};
    color: ${({ theme }) => theme.text.onPrimary};
    border: 1px solid ${({ theme }) => theme.colors.primary};

    &:hover:not(:disabled) {
      background: ${({ theme }) => theme.colors.primaryScale[600]};
      border-color: ${({ theme }) => theme.colors.primaryScale[600]};
    }
    &:active:not(:disabled) {
      background: ${({ theme }) => theme.colors.primaryScale[800]};
      border-color: ${({ theme }) => theme.colors.primaryScale[800]};
    }
  `,
  secondary: css`
    background: ${({ theme }) => theme.bg.surface};
    color: ${({ theme }) => theme.text.primary};
    border: 1px solid ${({ theme }) => theme.border.default};

    &:hover:not(:disabled) {
      background: ${({ theme }) => theme.bg.subtle};
      border-color: ${({ theme }) => theme.border.strong};
    }
  `,
  ghost: css`
    background: transparent;
    color: ${({ theme }) => theme.text.primary};
    border: 1px solid transparent;

    &:hover:not(:disabled) {
      background: ${({ theme }) => theme.bg.subtle};
    }
  `,
  danger: css`
    background: ${({ theme }) => theme.colors.danger};
    color: #fff;
    border: 1px solid ${({ theme }) => theme.colors.danger};

    &:hover:not(:disabled) {
      filter: brightness(0.92);
    }
  `,
}

interface StyledButtonProps {
  $variant: ButtonVariant
  $size: ButtonSize
  $fullWidth: boolean
  $loading: boolean
}

const StyledButton = styled.button<StyledButtonProps>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  line-height: 1;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition:
    background-color ${({ theme }) => theme.transitions.fast}
      ${({ theme }) => theme.transitions.easing},
    border-color ${({ theme }) => theme.transitions.fast}
      ${({ theme }) => theme.transitions.easing},
    color ${({ theme }) => theme.transitions.fast}
      ${({ theme }) => theme.transitions.easing},
    box-shadow ${({ theme }) => theme.transitions.fast}
      ${({ theme }) => theme.transitions.easing};

  ${({ $size }) => sizeStyles[$size]}
  ${({ $variant }) => variantStyles[$variant]}
  ${({ $fullWidth }) => $fullWidth && 'width: 100%;'}

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }

  ${({ $loading }) =>
    $loading &&
    css`
      cursor: progress;
      opacity: 0.85;
    `}
`

const Spinner = styled.span`
  display: inline-block;
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Honor user motion preferences. */
  @media (prefers-reduced-motion: reduce) {
    animation-duration: 1.6s;
  }
`

// Button — the single source of truth for clickable actions.
//
// Variants: primary (CTA, brand purple), secondary (outlined neutral),
// ghost (transparent, hover-tinted), danger (destructive). Sizes
// `sm/md/lg` with `md` enforcing the WCAG 2.5.5 44 px touch target.
//
// `loading` disables the button and renders an accessible spinner;
// `iconLeft` / `iconRight` slot in any node (an emoji, an SVG, a
// react-icon). `fullWidth` stretches to its container — useful for
// modal/footer placement.
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      fullWidth = false,
      loading = false,
      disabled,
      iconLeft,
      iconRight,
      type = 'button',
      children,
      ...rest
    },
    ref
  ) => {
    return (
      <StyledButton
        ref={ref}
        type={type}
        $variant={variant}
        $size={size}
        $fullWidth={fullWidth}
        $loading={loading}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading ? <Spinner aria-hidden="true" /> : iconLeft}
        {children}
        {!loading && iconRight}
      </StyledButton>
    )
  }
)
