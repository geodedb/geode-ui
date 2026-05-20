import React from 'react'
import styled from 'styled-components'
import { useThemePreference } from '../../theme'

export interface LogoProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** Image src used when the resolved theme is `light`. */
  lightSrc: string
  /** Image src used when the resolved theme is `dark`. */
  darkSrc: string
  /** Alt text for the logo image. Defaults to "Logo". */
  alt?: string
}

const Img = styled.img`
  display: block;
  max-width: 100%;
  height: auto;
`

export const Logo = React.forwardRef<HTMLImageElement, LogoProps>(
  ({ lightSrc, darkSrc, alt = 'Logo', ...rest }, ref) => {
    let resolved: 'dark' | 'light' = 'light'
    try {
      const pref = useThemePreference()
      resolved = pref.resolved
    } catch {
      // Outside of <ThemeProvider> — happens in Storybook / unit-test renders.
      resolved = 'light'
    }
    const src = resolved === 'dark' ? darkSrc : lightSrc
    return <Img ref={ref} src={src} alt={alt} {...rest} />
  },
)
