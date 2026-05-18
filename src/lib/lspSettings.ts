import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// Geode v0.5.18 LSP exposes textDocument/formatting with tunable options
// (parsed in src/cli/lsp/server.zig:600-628 of geode). These mirror the
// server-side keys verbatim (camelCase) and are passed through to
// initializationOptions.format on every LSP connect. Defaults come from
// the Zig FormattingOptions defaults and match what the LSP unit tests
// assert on, so unconfigured clients see the same output the server
// authors intended.
export interface LspFormatOptions {
  indentSize: number
  maxLineLength: number
  minPropertiesToFold: number
  foldPropertyMaps: boolean
}

export const DEFAULT_LSP_FORMAT_OPTIONS: LspFormatOptions = {
  indentSize: 2,
  maxLineLength: 100,
  minPropertiesToFold: 3,
  foldPropertyMaps: true,
}

interface LspSettingsState {
  // autoFormatEnabled controls whether the QueryPage automatically runs
  // textDocument/formatting on queries that arrive from outside the
  // editor (schema-explorer "MATCH (n:Label)…" insertions, the dashboard's
  // ?statement=… deep links, history re-runs). Manual edits never get
  // auto-formatted; the user opted in by typing.
  autoFormatEnabled: boolean
  setAutoFormatEnabled: (v: boolean) => void

  format: LspFormatOptions
  setFormat: (next: Partial<LspFormatOptions>) => void
}

export const useLspSettings = create<LspSettingsState>()(
  persist(
    (set) => ({
      autoFormatEnabled: true,
      setAutoFormatEnabled: (v) => set({ autoFormatEnabled: v }),
      format: DEFAULT_LSP_FORMAT_OPTIONS,
      setFormat: (next) => set((s) => ({ format: { ...s.format, ...next } })),
    }),
    {
      name: 'geode.lsp.settings.v1',
      storage: createJSONStorage(() => {
        // SSR / jsdom safety: persist middleware constructs storage at
        // store-creation time, so we must hand it a Storage that
        // tolerates window being undefined. Returning a noop avoids
        // throwing during the first render tick on the server pass.
        if (typeof window === 'undefined') {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          }
        }
        return window.localStorage
      }),
      version: 1,
    }
  )
)
