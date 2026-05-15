/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { FindNodeInput } from './FindNodeInput'

const t = (k: string, o?: Record<string, unknown>): string => {
  if (o) return `${k}:${JSON.stringify(o)}`
  return k
}

describe('FindNodeInput', () => {
  it('reports match count for the current query', () => {
    const data = [
      { id: '1', props: { name: 'Alice' } },
      { id: '2', props: { name: 'Bob' } },
      { id: '3', props: { name: 'Alicia' } },
    ]
    render(
      <ThemeProvider theme={theme}>
        <FindNodeInput nodes={data} onPick={() => {}} t={t} />
      </ThemeProvider>
    )
    fireEvent.change(screen.getByTestId('graph-find-input'), {
      target: { value: 'ali' },
    })
    expect(screen.getByTestId('graph-find-count').textContent).toContain('2')
  })

  it('Enter picks the first match', () => {
    const onPick = jest.fn()
    const data = [{ id: '1', props: { name: 'Alice' } }]
    render(
      <ThemeProvider theme={theme}>
        <FindNodeInput nodes={data} onPick={onPick} t={t} />
      </ThemeProvider>
    )
    fireEvent.change(screen.getByTestId('graph-find-input'), {
      target: { value: 'alice' },
    })
    fireEvent.keyDown(screen.getByTestId('graph-find-input'), { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('1')
  })

  it('Enter does nothing when there are no matches', () => {
    const onPick = jest.fn()
    const data = [{ id: '1', props: { name: 'Alice' } }]
    render(
      <ThemeProvider theme={theme}>
        <FindNodeInput nodes={data} onPick={onPick} t={t} />
      </ThemeProvider>
    )
    fireEvent.change(screen.getByTestId('graph-find-input'), {
      target: { value: 'zzz' },
    })
    fireEvent.keyDown(screen.getByTestId('graph-find-input'), { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
  })
})
