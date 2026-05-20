import { renderHook } from '@testing-library/react'
import { useUniqueValues } from './useUniqueValues'

test('returns deduplicated, sorted string list from a picker', () => {
  const items = [
    { user: 'alice' },
    { user: 'bob' },
    { user: 'alice' },
    { user: 'carol' },
    { user: '' },
    { user: undefined },
  ]
  const { result } = renderHook(() => useUniqueValues(items, (i) => i.user))
  expect(result.current).toEqual(['alice', 'bob', 'carol'])
})

test('returns the same array identity when inputs are equivalent', () => {
  const a = [{ x: 'one' }, { x: 'two' }]
  const b = [{ x: 'one' }, { x: 'two' }]
  const { result, rerender } = renderHook(
    ({ items }: { items: typeof a }) => useUniqueValues(items, (i) => i.x),
    { initialProps: { items: a } }
  )
  const first = result.current
  rerender({ items: b })
  expect(result.current).toBe(first)
})

test('trims whitespace before dedupe so " bob " and "bob" collapse', () => {
  const items = [{ u: 'bob' }, { u: ' bob ' }, { u: 'BOB' }]
  const { result } = renderHook(() => useUniqueValues(items, (i) => i.u))
  expect(result.current).toEqual(['BOB', 'bob'])
})
