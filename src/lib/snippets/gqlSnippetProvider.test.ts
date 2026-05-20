import { registerGqlSnippetProvider } from './gqlSnippetProvider'
import { useSnippetStore, STARTER_SNIPPETS } from './snippetStore'

// GAP-063: prove the provider:
//   • registers itself with monaco.languages.registerCompletionItemProvider
//   • produces CompletionItemKind.Snippet entries with the
//     InsertAsSnippet rule (so Monaco honours `$1` tab-stops)
//   • reads the live snippet store on every call (so a fresh snippet
//     added via the settings UI surfaces without a remount).
//
// We mock the slice of `monaco-editor` the provider touches; no real
// editor is mounted.

type ProviderRecord = {
  language: string
  provider: {
    triggerCharacters: string[]
    provideCompletionItems: (
      model: {
        getWordUntilPosition: () => { startColumn: number; endColumn: number }
      },
      position: { lineNumber: number }
    ) => {
      suggestions: Array<{
        insertText: string
        insertTextRules: number
        kind: number
      }>
    }
  }
}

function makeMonaco() {
  const registrations: ProviderRecord[] = []
  const monaco = {
    languages: {
      registerCompletionItemProvider: (
        language: string,
        provider: ProviderRecord['provider']
      ) => {
        registrations.push({ language, provider })
        return { dispose: jest.fn() }
      },
      CompletionItemKind: { Snippet: 27 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    },
  } as unknown as typeof import('monaco-editor')
  return { registrations, monaco }
}

beforeEach(() => {
  useSnippetStore.setState({ snippets: STARTER_SNIPPETS })
})

test('registers a completion provider against the gql language', () => {
  const { registrations, monaco } = makeMonaco()
  registerGqlSnippetProvider(monaco, 'gql')
  expect(registrations).toHaveLength(1)
  expect(registrations[0]?.language).toBe('gql')
})

test('emits one CompletionItem per snippet with InsertAsSnippet', () => {
  const { registrations, monaco } = makeMonaco()
  registerGqlSnippetProvider(monaco, 'gql')
  const result = registrations[0]!.provider.provideCompletionItems(
    {
      getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
    },
    { lineNumber: 1 }
  )
  expect(result.suggestions.length).toBe(STARTER_SNIPPETS.length)
  result.suggestions.forEach((s) => {
    expect(s.kind).toBe(27) // CompletionItemKind.Snippet
    expect(s.insertTextRules).toBe(4) // InsertAsSnippet
  })
})

test('reflects live store updates without re-registration', () => {
  const { registrations, monaco } = makeMonaco()
  registerGqlSnippetProvider(monaco, 'gql')
  useSnippetStore.getState().add({
    name: 'Hot reload',
    prefix: 'hot',
    body: 'RETURN 1',
  })
  const result = registrations[0]!.provider.provideCompletionItems(
    {
      getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
    },
    { lineNumber: 1 }
  )
  expect(result.suggestions.length).toBe(STARTER_SNIPPETS.length + 1)
})
