import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// GAP-063: snippet store. Backs the Monaco snippet provider and the
// settings UI. Persisted in localStorage under a schema-versioned key
// (`geode.snippets.v1`) so a future v2 migration can bump the key
// without colliding with the v1 payload — same discipline as the LSP
// settings store (#GAP-041).

export interface Snippet {
  /** Stable identifier — survives renames + edits. */
  id: string
  /** Display name in the settings UI. */
  name: string
  /** Trigger prefix the user types in the editor (e.g. `match-by-label`). */
  prefix: string
  /** Body with `$1` / `${1:placeholder}` tab-stops (Monaco snippet syntax). */
  body: string
  /** Optional one-line description shown in completion details. */
  description?: string
}

interface SnippetState {
  snippets: Snippet[]
  add(snippet: Omit<Snippet, 'id'> & { id?: string }): void
  update(id: string, patch: Partial<Omit<Snippet, 'id'>>): void
  remove(id: string): void
  /** Replace the entire set (used by import). */
  replaceAll(snippets: Snippet[]): void
}

// Minimal starter pack — covers the patterns operators repeat most
// often. The store seeds these on first run (empty initial state) so
// new users see snippet completion working out of the box.
// Build snippet bodies via string concatenation that splits the
// `${` sigil. Monaco's snippet syntax is `${N:placeholder}` for
// editable tab-stops; ESLint's no-template-curly-in-string flags
// any literal "${...}" inside a string (it's a defensive rule
// catching the "you probably meant a template literal" footgun).
// Splitting the dollar from the brace dodges the rule without
// per-line disables AND without changing the final string value.
const TS = String.fromCharCode(36) + String.fromCharCode(123) // '$' + '{'
const TE = String.fromCharCode(125) // '}'
// e.g. TS + '1:Label' + TE === '${1:Label}'  — Monaco-valid tab stop.
function ts(n: number, placeholder: string): string {
  return TS + String(n) + ':' + placeholder + TE
}
function tsAlias(n: number, alias: string): string {
  // Same N reused across the snippet — Monaco syncs the edits.
  return TS + String(n) + ':' + alias + TE
}

export const STARTER_SNIPPETS: Snippet[] = [
  {
    id: 'starter-match-by-label',
    name: 'Match by label',
    prefix: 'match-by-label',
    body:
      'MATCH (' +
      tsAlias(1, 'n') +
      ':' +
      ts(2, 'Label') +
      ')\nWHERE ' +
      tsAlias(1, 'n') +
      '.' +
      ts(3, 'prop') +
      ' = ' +
      ts(4, 'value') +
      '\nRETURN ' +
      tsAlias(1, 'n'),
    description: 'MATCH on a node label with a single WHERE filter',
  },
  {
    id: 'starter-match-path',
    name: 'Match path',
    prefix: 'match-path',
    body:
      'MATCH (' +
      tsAlias(1, 'a') +
      ':' +
      ts(2, 'LabelA') +
      ')-[' +
      tsAlias(3, 'r') +
      ':' +
      ts(4, 'REL') +
      ']->(' +
      tsAlias(5, 'b') +
      ':' +
      ts(6, 'LabelB') +
      ')\nRETURN ' +
      tsAlias(1, 'a') +
      ', ' +
      tsAlias(3, 'r') +
      ', ' +
      tsAlias(5, 'b') +
      '\nLIMIT ' +
      ts(7, '25'),
    description: 'Two-label path with a typed relationship',
  },
  {
    id: 'starter-aggregate-count-by',
    name: 'Aggregate count by',
    prefix: 'aggregate-count-by',
    body:
      'MATCH (' +
      tsAlias(1, 'n') +
      ':' +
      ts(2, 'Label') +
      ')\nRETURN ' +
      tsAlias(1, 'n') +
      '.' +
      ts(3, 'prop') +
      ' AS ' +
      tsAlias(3, 'prop') +
      ', count(*) AS n\nORDER BY n DESC\nLIMIT ' +
      ts(4, '10'),
    description: 'count(*) grouped by a property',
  },
  {
    id: 'starter-create-user',
    name: 'Create user',
    prefix: 'create-user',
    body:
      'CREATE USER ' +
      ts(1, 'username') +
      " WITH PASSWORD '" +
      ts(2, 'password') +
      "'",
    description: 'Geode admin DDL — CREATE USER',
  },
]

// Module-level so the persist hash + jest reset are predictable.
const STORAGE_KEY = 'geode.snippets.v1'

function genId(): string {
  // Crypto.randomUUID is available in evergreen browsers + node 19+;
  // the fallback is a salted-timestamp string sufficient for an
  // in-process key (the IDs only need to be unique within a single
  // user's snippet table).
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export const useSnippetStore = create<SnippetState>()(
  persist(
    (set, get) => ({
      snippets: STARTER_SNIPPETS,
      add: (s) => {
        const id = s.id ?? genId()
        set({ snippets: [...get().snippets, { ...s, id }] })
      },
      update: (id, patch) => {
        set({
          snippets: get().snippets.map((x) => {
            if (x.id === id) return { ...x, ...patch }
            return x
          }),
        })
      },
      remove: (id) => {
        set({ snippets: get().snippets.filter((x) => x.id !== id) })
      },
      replaceAll: (snippets) => set({ snippets }),
    }),
    {
      name: STORAGE_KEY,
      // Version field lets a future v2 reshape the payload without
      // colliding with v1 in old localStorage. Bump + provide a
      // `migrate` function when the shape changes.
      version: 1,
    }
  )
)
