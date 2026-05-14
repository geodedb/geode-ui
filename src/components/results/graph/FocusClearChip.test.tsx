/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { FocusClearChip } from './FocusClearChip'

const t = (k: string) => k

describe('FocusClearChip', () => {
  it('renders nothing when active=false', () => {
    render(
      <ThemeProvider theme={theme}>
        <FocusClearChip active={false} onClear={() => {}} t={t} />
      </ThemeProvider>
    )
    expect(screen.queryByTestId('graph-focus-clear-chip')).toBeNull()
  })

  it('renders the chip when active=true and fires onClear on click', () => {
    const onClear = jest.fn()
    render(
      <ThemeProvider theme={theme}>
        <FocusClearChip active onClear={onClear} t={t} />
      </ThemeProvider>
    )
    const chip = screen.getByTestId('graph-focus-clear-chip')
    expect(chip).toBeInTheDocument()
    fireEvent.click(chip)
    expect(onClear).toHaveBeenCalled()
  })
})
