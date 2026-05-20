// GAP-062: map LSP hover keywords / completion-item titles to their
// canonical spec page + anchor. The renderer-side LSP hover handler
// (see src/lib/lsp/client.ts) appends a `Learn more →` link when
// `gqlSpecAnchor(title)` returns a non-null route — that anchor opens
// the in-app docs viewer (GAP-061) at the matching position.

export interface SpecAnchor {
  /** Docs route — usable directly in <Link to=…>. */
  href: string
  /** Page slug (without leading slash). */
  page: string
  /** Heading-derived anchor (matches markdown.ts's `slug()` output). */
  anchor: string
}

// Static lookup. Keys are normalised to upper-case so the LSP can
// pass through completion titles or hovered tokens uniformly. New
// spec coverage requires extending both this map AND the docs page
// it points at — keep them in lockstep.
const INDEX: Record<string, SpecAnchor> = {
  // Core
  MATCH: { href: '/docs/gql-core#match', page: 'gql-core', anchor: 'match' },
  RETURN: {
    href: '/docs/gql-core#return',
    page: 'gql-core',
    anchor: 'return',
  },
  WHERE: { href: '/docs/gql-core#where', page: 'gql-core', anchor: 'where' },
  CREATE: {
    href: '/docs/gql-core#create',
    page: 'gql-core',
    anchor: 'create',
  },
  WITH: { href: '/docs/gql-core#with', page: 'gql-core', anchor: 'with' },
  LIMIT: {
    href: '/docs/gql-core#limit-skip',
    page: 'gql-core',
    anchor: 'limit-skip',
  },
  SKIP: {
    href: '/docs/gql-core#limit-skip',
    page: 'gql-core',
    anchor: 'limit-skip',
  },
  'ORDER BY': {
    href: '/docs/gql-core#order-by',
    page: 'gql-core',
    anchor: 'order-by',
  },
  'USE GRAPH': {
    href: '/docs/gql-core#use-graph',
    page: 'gql-core',
    anchor: 'use-graph',
  },
  // Auth DDL
  'CREATE USER': {
    href: '/docs/gql-auth-ddl#create-user',
    page: 'gql-auth-ddl',
    anchor: 'create-user',
  },
  'DROP USER': {
    href: '/docs/gql-auth-ddl#drop-user',
    page: 'gql-auth-ddl',
    anchor: 'drop-user',
  },
  'CREATE ROLE': {
    href: '/docs/gql-auth-ddl#create-role',
    page: 'gql-auth-ddl',
    anchor: 'create-role',
  },
  GRANT: {
    href: '/docs/gql-auth-ddl#grant',
    page: 'gql-auth-ddl',
    anchor: 'grant',
  },
  REVOKE: {
    href: '/docs/gql-auth-ddl#revoke',
    page: 'gql-auth-ddl',
    anchor: 'revoke',
  },
  // Policies (upstream-deferred — link to the page so the user sees
  // the deferral note).
  'CREATE POLICY': {
    href: '/docs/gql-policies',
    page: 'gql-policies',
    anchor: '',
  },
}

/**
 * Resolve a hover token / completion-item title to its spec anchor,
 * or null when no anchor is indexed for that token. Case-insensitive,
 * whitespace-collapsed.
 */
export function gqlSpecAnchor(title: string): SpecAnchor | null {
  if (typeof title !== 'string' || title.length === 0) return null
  const key = title.trim().replace(/\s+/g, ' ').toUpperCase()
  return INDEX[key] ?? null
}
