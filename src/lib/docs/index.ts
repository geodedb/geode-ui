// GAP-061: docs index. Bundles a curated subset of in-tree Markdown
// files at build time so the in-app /docs viewer can render them
// offline (Electron) and without an extra network round-trip
// (browser). New pages get added here and indexed by slug.
//
// The raw text is loaded via webpack's `asset/source` rule on .md
// files (see webpack.common.js); the renderer (./markdown.ts) does
// DOMPurify-wrapped HTML synthesis. Every entry MUST set `slug`,
// `title`, and `body`; `category` groups pages in the sidebar.

// Each `import ... from '../../../docs/<x>.md'` resolves to the file
// contents at build time. TypeScript needs a module declaration to
// accept the import; see src/types/md-modules.d.ts (added alongside).
import architectureMd from '../../../docs/ARCHITECTURE.md'
import electronMd from '../../../docs/ELECTRON.md'
import operationsMd from '../../../docs/OPERATIONS.md'
import connectionsVsProfilesMd from '../../../docs/CONNECTIONS_VS_PROFILES.md'
import i18nMd from '../../../docs/I18N.md'

export interface DocPage {
  slug: string
  title: string
  category: 'concept' | 'reference' | 'operations'
  body: string
}

export const DOC_PAGES: DocPage[] = [
  {
    slug: 'architecture',
    title: 'Architecture',
    category: 'concept',
    body: architectureMd as unknown as string,
  },
  {
    slug: 'connections-vs-profiles',
    title: 'Connections vs Profiles',
    category: 'concept',
    body: connectionsVsProfilesMd as unknown as string,
  },
  {
    slug: 'electron',
    title: 'Electron desktop build',
    category: 'reference',
    body: electronMd as unknown as string,
  },
  {
    slug: 'operations',
    title: 'Operations',
    category: 'operations',
    body: operationsMd as unknown as string,
  },
  {
    slug: 'i18n',
    title: 'Internationalisation',
    category: 'reference',
    body: i18nMd as unknown as string,
  },
]

export function findDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((p) => p.slug === slug)
}
