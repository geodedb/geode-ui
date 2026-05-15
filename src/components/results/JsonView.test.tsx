/// <reference types="@testing-library/jest-dom" />
import React, { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../test-utils/theme'
import { JsonView } from './JsonView'

// PERF-2026-05-11-08 (#147): JsonView wraps JSON.stringify in
// useMemo(..., [data]) and the component in React.memo, so a parent
// re-render that hands back the same `data` reference must NOT
// re-serialize. We assert that by spying on JSON.stringify and forcing
// extra parent renders that leave `data` referentially stable.
describe('JsonView', () => {
  function renderWithTheme(ui: React.ReactElement): ReturnType<typeof render> {
    return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
  }

  test('renders the pretty-printed JSON', () => {
    renderWithTheme(<JsonView data={{ a: 1, b: ['x', 'y'] }} />)
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument()
    expect(screen.getByText(/"x"/)).toBeInTheDocument()
  })

  test('does not re-stringify when `data` is referentially stable across a parent re-render', () => {
    const stableData = { rows: [[1, 'alice']], columns: [{ name: 'n' }] }
    const stringifySpy = jest.spyOn(JSON, 'stringify')

    const Parent: React.FC = () => {
      const [, setTick] = useState(0)
      return (
        <ThemeProvider theme={theme}>
          <button type="button" onClick={() => setTick((n) => n + 1)}>
            bump
          </button>
          <JsonView data={stableData} />
        </ThemeProvider>
      )
    }

    renderWithTheme(<Parent />)
    // Capture the call count once the initial render's stringify happened.
    const afterFirstRender = stringifySpy.mock.calls.length
    expect(afterFirstRender).toBeGreaterThan(0)

    // Force several parent re-renders; `stableData` reference is unchanged.
    fireEvent.click(screen.getByText('bump'))
    fireEvent.click(screen.getByText('bump'))
    fireEvent.click(screen.getByText('bump'))

    // No additional JSON.stringify calls — the memo (and React.memo on
    // the component) absorbed the unrelated parent re-renders.
    expect(stringifySpy.mock.calls.length).toBe(afterFirstRender)

    stringifySpy.mockRestore()
  })

  test('re-stringifies when `data` actually changes', () => {
    const stringifySpy = jest.spyOn(JSON, 'stringify')

    const Parent: React.FC = () => {
      const [data, setData] = useState<unknown>({ v: 1 })
      return (
        <ThemeProvider theme={theme}>
          <button type="button" onClick={() => setData({ v: 2 })}>
            change
          </button>
          <JsonView data={data} />
        </ThemeProvider>
      )
    }

    renderWithTheme(<Parent />)
    const before = stringifySpy.mock.calls.length
    fireEvent.click(screen.getByText('change'))
    expect(stringifySpy.mock.calls.length).toBeGreaterThan(before)
    expect(screen.getByText(/"v": 2/)).toBeInTheDocument()

    stringifySpy.mockRestore()
  })
})

it('the pre always fills its parent (no max-height cap)', () => {
  const { container } = render(
    <ThemeProvider theme={theme}>
      <div style={{ height: 1000 }}>
        <JsonView data={{ a: 1 }} />
      </div>
    </ThemeProvider>
  )
  const pre = container.querySelector('pre') as HTMLElement
  const cs = getComputedStyle(pre)
  expect(cs.maxHeight).toBe('none')
  expect(cs.flex).toMatch(/1 1 (0|auto)/)
})
