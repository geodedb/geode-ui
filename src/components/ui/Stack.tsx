import styled, { css } from 'styled-components'

import type { Theme } from '../../theme'

type SpacingKey = keyof Theme['spacing']
type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline'
type Justify =
  'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly'

interface FlexProps {
  $gap?: SpacingKey
  $align?: Align
  $justify?: Justify
  $wrap?: boolean
}

const alignMap: Record<Align, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
}

const justifyMap: Record<Justify, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  'space-between': 'space-between',
  'space-around': 'space-around',
  'space-evenly': 'space-evenly',
}

const flexBase = css<FlexProps>`
  display: flex;
  ${({ $gap, theme }) => $gap && `gap: ${theme.spacing[$gap]};`}
  ${({ $align }) => $align && `align-items: ${alignMap[$align]};`}
  ${({ $justify }) => $justify && `justify-content: ${justifyMap[$justify]};`}
  ${({ $wrap }) => $wrap && 'flex-wrap: wrap;'}
`

// Stack — vertical flex column. Defaults to `align: stretch`.
export const Stack = styled.div<FlexProps>`
  ${flexBase}
  flex-direction: column;
`

// Inline — horizontal flex row. Defaults to `align: center`.
export const Inline = styled.div<FlexProps>`
  ${flexBase}
  flex-direction: row;
  ${({ $align }) => !$align && 'align-items: center;'}
`

// Container — centered max-width wrapper with responsive horizontal
// padding. Mirrors @devnw/components' Container primitive.
export const Container = styled.div<{ $maxWidth?: number }>`
  width: 100%;
  max-width: ${({ $maxWidth }) => $maxWidth ?? 1280}px;
  margin: 0 auto;
  padding: 0 ${({ theme }) => theme.spacing.lg};

  @media (max-width: ${({ theme }) => theme.breakpoints.md - 0.02}px) {
    padding: 0 ${({ theme }) => theme.spacing.md};
  }
  @media (max-width: ${({ theme }) => theme.breakpoints.sm - 0.02}px) {
    padding: 0 ${({ theme }) => theme.spacing.sm};
  }
`

// Grid — basic responsive grid wrapper. Specify columns as a CSS
// `grid-template-columns` value; the component just supplies the
// theme-driven gap.
export const Grid = styled.div<{ $columns?: string; $gap?: SpacingKey }>`
  display: grid;
  grid-template-columns: ${({ $columns }) => $columns ?? '1fr'};
  gap: ${({ theme, $gap }) => theme.spacing[$gap ?? 'md']};
`

// Spacer — absorbs flex space. Useful for pushing siblings to the
// opposite end of a flex parent.
export const Spacer = styled.div`
  flex: 1 1 auto;
`
