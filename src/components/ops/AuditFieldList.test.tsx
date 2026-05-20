/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

import { AuditFieldList } from './AuditFieldList'
import { testTheme as theme } from '../../test-utils/theme'

function renderList(fields: Record<string, unknown> | undefined): void {
  render(
    <ThemeProvider theme={theme}>
      <AuditFieldList fields={fields} />
    </ThemeProvider>
  )
}

test('renders one <li> per field key=value pair', () => {
  renderList({ user: 'alice', role: 'admin', cid: 'c1' })
  const items = screen.getAllByTestId('audit-field-item')
  expect(items).toHaveLength(3)
})

test('renders nested objects as inline JSON for one-line readability', () => {
  renderList({ meta: { graph: 'g', rows: 3 } })
  const item = screen.getByTestId('audit-field-item')
  expect(item).toHaveTextContent('meta')
  expect(item).toHaveTextContent('"graph":"g"')
})

test('renders arrays as bracket-quoted inline JSON', () => {
  renderList({ roles: ['admin', 'reader'] })
  expect(screen.getByTestId('audit-field-item')).toHaveTextContent(
    '["admin","reader"]'
  )
})

test('renders nothing when the fields map is empty', () => {
  renderList({})
  expect(screen.queryAllByTestId('audit-field-item')).toHaveLength(0)
})

test('renders nothing when fields is undefined', () => {
  renderList(undefined)
  expect(screen.queryAllByTestId('audit-field-item')).toHaveLength(0)
})

test('orders keys alphabetically for stable diffability', () => {
  renderList({ z: 1, a: 2, m: 3 })
  const items = screen.getAllByTestId('audit-field-item')
  expect(items[0]).toHaveTextContent('a')
  expect(items[1]).toHaveTextContent('m')
  expect(items[2]).toHaveTextContent('z')
})

test('renders null values explicitly as "null"', () => {
  renderList({ deletedAt: null })
  expect(screen.getByTestId('audit-field-item')).toHaveTextContent('null')
})

test('renders BigInt values with the n suffix preserved', () => {
  // BigInt(...) constructor instead of the 9007199254740993n literal so
  // the project's es2015 tsconfig target stays satisfied. Same runtime
  // value, no literal-syntax dependency.
  renderList({ count: BigInt('9007199254740993') })
  expect(screen.getByTestId('audit-field-item')).toHaveTextContent(
    '9007199254740993n'
  )
})

test('renders Symbol values via Symbol.toString()', () => {
  renderList({ marker: Symbol('debug-only') })
  expect(screen.getByTestId('audit-field-item')).toHaveTextContent(
    'Symbol(debug-only)'
  )
})
