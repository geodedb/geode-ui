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
// GAP-062: GQL+ spec pages — one per subset. The slugs (`gql-core`,
// `gql-auth-ddl`, …) are referenced by the LSP-hover deep-link map at
// src/lib/docs/gqlSpecIndex.ts.
import gqlCoreMd from '../../../docs/gql-spec/core.md'
import gqlAuthDdlMd from '../../../docs/gql-spec/auth-ddl.md'
import gqlPoliciesMd from '../../../docs/gql-spec/policies.md'
import gqlMigrationsMd from '../../../docs/gql-spec/migrations.md'

export interface DocPage {
  slug: string
  title: string
  category: 'concept' | 'reference' | 'operations' | 'spec'
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
  // GAP-062: GQL+ spec library. Each entry's slug matches an anchor
  // in src/lib/docs/gqlSpecIndex.ts so the LSP hover deep-link
  // resolves to the right place.
  {
    slug: 'gql-core',
    title: 'GQL+ — Core',
    category: 'spec',
    body: gqlCoreMd as unknown as string,
  },
  {
    slug: 'gql-auth-ddl',
    title: 'GQL+ — Auth DDL',
    category: 'spec',
    body: gqlAuthDdlMd as unknown as string,
  },
  {
    slug: 'gql-policies',
    title: 'GQL+ — Policies',
    category: 'spec',
    body: gqlPoliciesMd as unknown as string,
  },
  {
    slug: 'gql-migrations',
    title: 'GQL+ — Migrations',
    category: 'spec',
    body: gqlMigrationsMd as unknown as string,
  },
]

export function findDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((p) => p.slug === slug)
}
