import React from 'react'
import styled from 'styled-components'

import logoDark from '../../assets/brand/logo-dark.svg'
import logoLight from '../../assets/brand/logo-light.svg'
import { useThemePreference } from '../../theme'

export interface LogoProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /**
   * Vertical pixel size. Width is derived from the SVG's intrinsic
   * aspect ratio (~3.67:1 for the full wordmark).
   */
  height?: number
  /**
   * Force a variant — useful for surfaces that don't match the global
   * theme (e.g. the LoginPage card always sits on a light surface
   * even when the OS prefers dark).
   */
  variant?: 'auto' | 'on-light' | 'on-dark'
  /** Accessible label. Defaults to "Geode". */
  alt?: string
}

const Img = styled.img`
  display: block;
  height: 100%;
  width: auto;
  user-select: none;
  /* Prevent the browser drag-image when the wordmark sits in a nav */
  -webkit-user-drag: none;
`

const Wrap = styled.span<{ $height: number }>`
  display: inline-flex;
  align-items: center;
  height: ${({ $height }) => $height}px;
`

// Logo — geodedb.com brand wordmark.
//
// Picks the right asset for the resolved theme: `logo-dark.svg` (dark
// wordmark with #96929b text) for light surfaces, `logo-light.svg`
// (white text) for dark surfaces. Falls back to the dark wordmark
// when the preference context isn't mounted (which never happens in
// production but keeps Storybook / unit-test renders clean).
export const Logo: React.FC<LogoProps> = ({
  height = 28,
  variant = 'auto',
  alt = 'Geode',
  ...rest
}) => {
  let pref: ReturnType<typeof useThemePreference> | null = null
  try {
    pref = useThemePreference()
  } catch {
    // Outside of <ThemeProvider> — happens in some snapshot tests.
    pref = null
  }
  let mode: 'on-light' | 'on-dark'
  if (variant !== 'auto') {
    mode = variant
  } else if (pref?.resolved === 'dark') {
    mode = 'on-dark'
  } else {
    mode = 'on-light'
  }
  const src = mode === 'on-dark' ? logoLight : logoDark
  return (
    <Wrap $height={height}>
      <Img src={src} alt={alt} draggable={false} {...rest} />
    </Wrap>
  )
}
