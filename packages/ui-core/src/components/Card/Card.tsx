import React from 'react'
import styled from 'styled-components'

// Card primitives migrated to Bootstrap utilities per
// BOOTSTRAP_MIGRATION.md. theme-bridge.ts emits `--bs-*` variables
// sourced from the active theme, so utilities like `bg-body`,
// `border`, `rounded-4`, `shadow-sm` track light/dark mode through
// the bridged custom properties.
//
// theme token → Bootstrap class:
//   bg.surface          → bg-body
//   border.subtle       → border (via --bs-border-color)
//   radii.xl (12px)     → rounded-4
//   shadows.sm          → shadow-sm
//   spacing.lg (24px)   → p-4
//   spacing.md (16px)   → gap-3, mb-3
//   font.sizes.lg       → fs-5 (still close enough; bridge handles)
//   font.sizes.sm       → small
//   text.primary        → text-body
//   text.muted          → text-body-tertiary
//
// CardTitle keeps a small styled wrapper because theme.font.family.display
// is not a Bootstrap utility — it's a separate display font that the bridge
// doesn't expose via Bootstrap's font-family classes.

type DivAttrs<E extends HTMLElement = HTMLElement> = React.HTMLAttributes<E>

function mergeClass(base: string, cls?: string): string {
  return cls ? `${base} ${cls}` : base
}

export const Card: React.FC<
  DivAttrs<HTMLElement> & { children?: React.ReactNode }
> = ({ className, children, ...rest }) => (
  <section
    className={mergeClass('bg-body border rounded-4 shadow-sm p-4', className)}
    {...rest}
  >
    {children}
  </section>
)

export const CardHeader: React.FC<
  DivAttrs<HTMLElement> & { children?: React.ReactNode }
> = ({ className, children, ...rest }) => (
  <header
    className={mergeClass('d-flex align-items-center gap-3 mb-3', className)}
    {...rest}
  >
    {children}
  </header>
)

// CardTitle — kept as a styled-component because theme.font.family.display
// has no Bootstrap utility equivalent (the bridge maps body + monospace
// only). Keeps the display font and semibold weight from theme tokens.
export const CardTitle = styled.h2`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.lg};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  color: ${({ theme }) => theme.text.primary};
  margin: 0;
`

export const CardSubtitle: React.FC<
  React.HTMLAttributes<HTMLParagraphElement>
> = ({ className, children, ...rest }) => (
  <p
    className={mergeClass('small text-body-tertiary m-0', className)}
    {...rest}
  >
    {children}
  </p>
)
