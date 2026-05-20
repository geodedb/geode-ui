import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

import { testTheme as theme } from '../../test-utils/theme'
import { Button } from './Button'

const wrap = (ui: React.ReactNode) =>
  render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)

test('renders children and reacts to click', () => {
  const onClick = jest.fn()
  wrap(<Button onClick={onClick}>Save</Button>)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onClick).toHaveBeenCalledTimes(1)
})

test('loading mode disables click and exposes aria-busy', () => {
  const onClick = jest.fn()
  wrap(
    <Button loading onClick={onClick}>
      Submitting
    </Button>
  )
  const btn = screen.getByRole('button', { name: /Submitting/ })
  expect(btn).toBeDisabled()
  expect(btn).toHaveAttribute('aria-busy', 'true')
  fireEvent.click(btn)
  expect(onClick).not.toHaveBeenCalled()
})

test('disabled prop blocks click', () => {
  const onClick = jest.fn()
  wrap(
    <Button disabled onClick={onClick}>
      Off
    </Button>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Off' }))
  expect(onClick).not.toHaveBeenCalled()
})

test('accepts custom type and forwards refs', () => {
  const ref = React.createRef<HTMLButtonElement>()
  wrap(
    <Button ref={ref} type="submit">
      Submit
    </Button>
  )
  expect(ref.current).not.toBeNull()
  expect(ref.current?.type).toBe('submit')
})

test('renders icons in their slots', () => {
  wrap(
    <Button
      iconLeft={<span data-testid="left">L</span>}
      iconRight={<span data-testid="right">R</span>}
    >
      Go
    </Button>
  )
  expect(screen.getByTestId('left')).toBeInTheDocument()
  expect(screen.getByTestId('right')).toBeInTheDocument()
})
