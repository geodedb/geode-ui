import { useSnippetStore, STARTER_SNIPPETS } from './snippetStore'

// GAP-063: lock in the snippet store contract. The store ships with a
// starter pack on first run, supports CRUD, and round-trips through
// localStorage under a versioned key.

describe('useSnippetStore', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useSnippetStore.setState({ snippets: STARTER_SNIPPETS })
  })

  test('seeds the starter pack on first run', () => {
    expect(useSnippetStore.getState().snippets.length).toBeGreaterThan(0)
    const prefixes = useSnippetStore.getState().snippets.map((s) => s.prefix)
    expect(prefixes).toContain('match-by-label')
    expect(prefixes).toContain('create-user')
  })

  test('add() appends a snippet with a generated id', () => {
    useSnippetStore.getState().add({
      name: 'Test',
      prefix: 'test',
      body: 'MATCH (n) RETURN n LIMIT 1',
    })
    const last =
      useSnippetStore.getState().snippets[
        useSnippetStore.getState().snippets.length - 1
      ]
    expect(last?.name).toBe('Test')
    expect(last?.id).toBeDefined()
    expect(last?.id.length).toBeGreaterThan(0)
  })

  test('update() patches a snippet in place', () => {
    const id = useSnippetStore.getState().snippets[0]!.id
    useSnippetStore.getState().update(id, { name: 'Renamed' })
    expect(useSnippetStore.getState().snippets[0]?.name).toBe('Renamed')
  })

  test('remove() drops the matching id', () => {
    const initialCount = useSnippetStore.getState().snippets.length
    const id = useSnippetStore.getState().snippets[0]!.id
    useSnippetStore.getState().remove(id)
    expect(useSnippetStore.getState().snippets.length).toBe(initialCount - 1)
    expect(
      useSnippetStore.getState().snippets.find((s) => s.id === id)
    ).toBeUndefined()
  })

  test('replaceAll() swaps the entire set (used by import)', () => {
    const replacement = [
      {
        id: 'imported-1',
        name: 'Imported',
        prefix: 'imp',
        body: 'RETURN 1',
      },
    ]
    useSnippetStore.getState().replaceAll(replacement)
    expect(useSnippetStore.getState().snippets).toEqual(replacement)
  })

  test('persists under a schema-versioned localStorage key', () => {
    useSnippetStore.getState().add({
      name: 'Persisted',
      prefix: 'persist',
      body: 'MATCH (n) RETURN n',
    })
    const raw = window.localStorage.getItem('geode.snippets.v1')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string) as {
      state: { snippets: Array<{ name: string }> }
      version: number
    }
    expect(parsed.version).toBe(1)
    expect(parsed.state.snippets.some((s) => s.name === 'Persisted')).toBe(true)
  })
})
