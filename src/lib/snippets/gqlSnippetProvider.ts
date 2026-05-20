import type * as MonacoEditorApi from 'monaco-editor'

import { useSnippetStore, type Snippet } from './snippetStore'

// GAP-063: Monaco completion provider that surfaces every snippet in
// `useSnippetStore` as a `CompletionItemKind.Snippet` entry. The
// provider reads the store synchronously per completion request so a
// user can author a snippet in the settings UI and see it available
// in the editor without a remount. `insertTextRules: InsertAsSnippet`
// tells Monaco to honour `$1` / `${1:placeholder}` tab-stops; without
// it Monaco inserts the body verbatim and the user has to hunt for
// the placeholders by hand.

export function registerGqlSnippetProvider(
  monaco: typeof MonacoEditorApi,
  languageId: string
): MonacoEditorApi.IDisposable {
  return monaco.languages.registerCompletionItemProvider(languageId, {
    triggerCharacters: ['-', '_', '$'],
    provideCompletionItems: (model, position) => {
      // Compute the word range so Monaco replaces the trigger token
      // (not just inserts) — otherwise typing `match-by` and
      // selecting the snippet would leave the partial token behind.
      const word = model.getWordUntilPosition(position)
      const range: MonacoEditorApi.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }
      const snippets = useSnippetStore.getState().snippets
      const suggestions = snippets.map(toCompletionItem(monaco, range))
      return { suggestions }
    },
  })
}

function toCompletionItem(
  monaco: typeof MonacoEditorApi,
  range: MonacoEditorApi.IRange
): (s: Snippet) => MonacoEditorApi.languages.CompletionItem {
  return (s) => ({
    label: s.prefix,
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: s.body,
    insertTextRules:
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: s.description ?? s.name,
    detail: s.name,
    range,
  })
}
