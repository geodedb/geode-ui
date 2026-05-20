import React from 'react'
import styled from 'styled-components'
import { Logo, type LogoProps } from '@geodedb/ui-core'
import logoDark from '../../assets/brand/logo-dark.svg'
import logoLight from '../../assets/brand/logo-light.svg'

/**
 * `variant` mirrors the original Logo API:
 * - `'auto'`     — pick asset based on the resolved theme (default)
 * - `'on-light'` — always use the dark-text wordmark (for light surfaces)
 * - `'on-dark'`  — always use the light-text wordmark (for dark surfaces)
 */
export type GeodeLogoVariant = 'auto' | 'on-light' | 'on-dark'

export type GeodeLogoProps = Omit<LogoProps, 'lightSrc' | 'darkSrc'> & {
  /**
   * Force a variant — useful for surfaces that don't follow the global theme
   * (e.g. the LoginPage card always sits on a light surface).
   */
  variant?: GeodeLogoVariant
  /**
   * Vertical pixel size. Width is derived from the SVG's intrinsic
   * aspect ratio (~3.67:1 for the full wordmark).
   */
  height?: number
}

const Wrap = styled.span<{ $height: number }>`
  display: inline-flex;
  align-items: center;
  height: ${({ $height }) => $height}px;
`

export const GeodeLogo = ({
  alt = 'Geode',
  variant = 'auto',
  height = 28,
  ...rest
}: GeodeLogoProps): React.ReactElement => {
  // When variant is forced, both src props receive the same asset so the
  // library Logo's theme-based selection has no effect.
  const light = variant === 'on-dark' ? logoLight : logoDark
  const dark = variant === 'on-light' ? logoDark : logoLight

  return (
    <Wrap $height={height}>
      <Logo
        lightSrc={light}
        darkSrc={dark}
        alt={alt}
        draggable={false}
        style={
          {
            height: '100%',
            width: 'auto',
            userSelect: 'none',
            WebkitUserDrag: 'none',
          } as React.CSSProperties
        }
        {...rest}
      />
    </Wrap>
  )
}
