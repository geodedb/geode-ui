import {
  INTERVAL_FUNCTIONS,
  intervalCompletionItems,
} from './intervalFunctions'

// Minimal monaco stub for the test — only the symbols that
// intervalCompletionItems dereferences.
const monacoStub = {
  languages: {
    CompletionItemKind: { Function: 1 },
  },
} as unknown as Parameters<typeof intervalCompletionItems>[0]

const range = {
  startLineNumber: 1,
  endLineNumber: 1,
  startColumn: 1,
  endColumn: 1,
}

test('exports the three new interval functions', () => {
  const names = INTERVAL_FUNCTIONS.map((f) => f.name).sort()
  expect(names).toEqual(['Interval', 'interval_contains', 'interval_overlaps'])
})

test('every spec carries a non-empty signature and description', () => {
  INTERVAL_FUNCTIONS.forEach((fn) => {
    expect(fn.signature.length).toBeGreaterThan(0)
    expect(fn.description.length).toBeGreaterThan(0)
  })
})

test('intervalCompletionItems returns Monaco-shaped suggestions', () => {
  const items = intervalCompletionItems(monacoStub, range)
  expect(items).toHaveLength(3)
  items.forEach((item) => {
    expect(typeof item.label).toBe('string')
    expect(typeof item.insertText).toBe('string')
    expect(item.kind).toBe(1)
    expect(item.documentation).toMatchObject({ value: expect.any(String) })
    expect(item.range).toEqual(range)
  })
})

test('signatures embed the function name', () => {
  INTERVAL_FUNCTIONS.forEach((fn) => {
    expect(fn.signature.startsWith(fn.name)).toBe(true)
  })
})
