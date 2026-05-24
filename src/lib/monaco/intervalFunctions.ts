// New GQL functions shipped in Geode 0.5.20 (commit 384c3bf0):
//   Interval(str)            - alias for duration(str); ISO-8601 input.
//   interval_overlaps(a, b)  - true when both intervals are non-empty.
//   interval_contains(a, b)  - true when a >= b in canonical microseconds.
//
// Surfaced to the Monaco editor as completion suggestions so the
// operator's autocomplete carries the new vocabulary. The completion
// provider is registered alongside the snippet provider in
// GqlEditor.tsx.

import type * as MonacoEditorApi from 'monaco-editor'

export interface IntervalFunctionSpec {
  name: string
  signature: string
  description: string
}

export const INTERVAL_FUNCTIONS: IntervalFunctionSpec[] = [
  {
    name: 'Interval',
    signature: "Interval('P1DT2H')",
    description:
      'Constructs an Interval (alias for duration()). Accepts an ISO-8601 duration string.',
  },
  {
    name: 'interval_overlaps',
    signature: 'interval_overlaps(a, b)',
    description:
      'Returns TRUE when both intervals are non-empty (i.e. they share any moment).',
  },
  {
    name: 'interval_contains',
    signature: 'interval_contains(outer, inner)',
    description:
      'Returns TRUE when outer fully contains inner (outer >= inner in canonical microseconds).',
  },
]

// intervalCompletionItems returns Monaco-shaped suggestions. The
// `range` argument should be the word-prefix range so Monaco replaces
// the partial token at the cursor (not inserts after it). Caller is
// registerIntervalCompletionProvider below.
export function intervalCompletionItems(
  monaco: typeof MonacoEditorApi,
  range: MonacoEditorApi.IRange
): MonacoEditorApi.languages.CompletionItem[] {
  return INTERVAL_FUNCTIONS.map((fn) => ({
    label: fn.name,
    kind: monaco.languages.CompletionItemKind.Function,
    insertText: fn.signature,
    documentation: { value: fn.description },
    detail: fn.signature,
    range,
  }))
}

// registerIntervalCompletionProvider wires the suggestions into the
// editor's completion pipeline. Returns a disposable so the caller
// can tear it down on unmount.
export function registerIntervalCompletionProvider(
  monaco: typeof MonacoEditorApi,
  languageId: string
): MonacoEditorApi.IDisposable {
  return monaco.languages.registerCompletionItemProvider(languageId, {
    triggerCharacters: ['I', 'i'],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position)
      const range: MonacoEditorApi.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }
      return { suggestions: intervalCompletionItems(monaco, range) }
    },
  })
}
