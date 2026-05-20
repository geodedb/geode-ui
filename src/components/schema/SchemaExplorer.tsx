import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import styled from 'styled-components'

import { client } from '../../api/client'
import type { Theme } from '../../theme'
import { below } from '../../theme'
import { LabelList } from './LabelList'
import { EdgeTypeList } from './EdgeTypeList'
import {
  createSchemaCache,
  defaultSchemaCache,
  type SchemaCacheLike,
  type SchemaIndexConstraintEntry,
} from './schemaCache'

// PERF-F8 (#52) / PERF-2026-05-11-10 (#154): per-graph cache for the
// index+constraint pair so re-selecting a graph the operator has
// already viewed this session is instant — no second wire round-trip.
// The cache implementation now lives in ./schemaCache and is shared
// with LabelList / EdgeTypeList (one bounded LRU across all four schema
// reads). The server-side cache (#128, internal/server/schema_cache.go,
// 120s TTL) backs the cold-miss case.
type SchemaCacheEntry = SchemaIndexConstraintEntry

// SchemaExplorerCacheLike keeps the historical pair-accessor surface
// (`get`/`put` on the indexes+constraints pair) on top of the shared
// SchemaCacheLike, so existing call sites and tests (which import from
// './SchemaExplorer' and call `cache.put(graph, { indexes, constraints
// })`) keep working unchanged.
export type SchemaExplorerCacheLike = SchemaCacheLike & {
  get(graph: string): SchemaCacheEntry | undefined
  put(graph: string, entry: SchemaCacheEntry): void
}

// createSchemaExplorerCache wraps a fresh shared cache and adds the
// pair-accessor shim. Production callers omit the `cache` prop and
// inherit the module-level defaultSchemaCache; tests inject a fresh
// instance per run.
export function createSchemaExplorerCache(
  maxEntries?: number
): SchemaExplorerCacheLike {
  const shared =
    maxEntries === undefined
      ? createSchemaCache()
      : createSchemaCache(maxEntries)
  return {
    ...shared,
    get(graph) {
      return shared.getIndexConstraints(graph)
    },
    put(graph, entry) {
      shared.putIndexConstraints(graph, entry)
    },
  }
}

interface ActiveProps {
  theme: Theme
  $active: boolean
}

function graphBtnBg({ $active, theme }: ActiveProps): string {
  return $active ? theme.bg.subtle : 'transparent'
}

function graphBtnBorder({ $active, theme }: ActiveProps): string {
  return $active ? theme.border.default : theme.border.subtle
}

// SchemaExplorer is the three-column panel:
//
//   1. Graph picker (driven by GET /api/v1/graphs)
//   2. Labels for the active graph
//   3. Edge types + indexes + constraints for the active graph
//
// The picker auto-selects the first graph the server returns so the
// Labels / Edge-types panes have something to render on first load. If
// the server returns no graphs, the right-hand panes stay empty. Both
// indexes and constraints are dumped as JSON for now -- the underlying
// API returns `Array<Record<string, unknown>>`, which we don't yet have
// strong typing for at the UI layer.
const Layout = styled.div`
  display: grid;
  grid-template-columns: 220px 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.md};
  align-items: start;

  ${below('lg')`
    grid-template-columns: 1fr 1fr;
  `}

  ${below('md')`
    grid-template-columns: 1fr;
  `}
`

const Pane = styled.section`
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.lg};
  padding: ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.text.primary};

  h3 {
    margin: 0 0 ${({ theme }) => theme.spacing.sm};
    font-family: ${({ theme }) => theme.font.family.display};
    font-size: ${({ theme }) => theme.font.sizes.lg};
    font-weight: ${({ theme }) => theme.font.weights.semibold};
  }

  h4 {
    margin: ${({ theme }) => theme.spacing.md} 0
      ${({ theme }) => theme.spacing.xs};
    font-size: ${({ theme }) => theme.font.sizes.sm};
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: ${({ theme }) => theme.text.secondary};
  }
`

// GraphList was a pure-layout `<ul>` (vertical flex with theme.spacing.xs
// gap) — migrated inline to Bootstrap utilities `list-unstyled m-0 p-0
// d-flex flex-column gap-1` per BOOTSTRAP_MIGRATION.md.

const GraphBtn = styled.button<{ $active: boolean }>`
  text-align: left;
  padding: 8px 12px;
  width: 100%;
  min-height: 36px;
  background: ${graphBtnBg};
  color: ${({ theme }) => theme.text.primary};
  border: 1px solid ${graphBtnBorder};
  border-radius: ${({ theme }) => theme.radii.md};
  cursor: pointer;
  font-family: inherit;
  font-size: ${({ theme }) => theme.font.sizes.md};

  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
  }

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

// Pre keeps a styled-component: the mono font family + scroll cap
// (overflow: auto, max-height: 200px) and the 12px (xs) font-size
// don't compose cleanly out of Bootstrap utilities — `text-monospace`
// resolves to a different family and there's no max-height utility.
const Pre = styled.pre`
  background: ${({ theme }) => theme.bg.canvas};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.sm};
  font-family: ${({ theme }) => theme.font.family.mono};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  overflow: auto;
  max-height: 200px;
  color: ${({ theme }) => theme.text.primary};
`

// SchemaExplorerProps lets tests inject a fresh cache instance per
// run; production callers omit the prop and inherit the module-level
// defaultSchemaCache. The prop accepts any SchemaCacheLike — the
// pair-accessor superset returned by createSchemaExplorerCache is
// assignable.
export type SchemaExplorerProps = {
  cache?: SchemaCacheLike
}

export const SchemaExplorer: React.FC<SchemaExplorerProps> = ({ cache }) => {
  const { t } = useTranslation()
  const [graphs, setGraphs] = useState<string[]>([])
  const [active, setActive] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)
  const [indexes, setIndexes] = useState<Array<Record<string, unknown>>>([])
  const [constraints, setConstraints] = useState<
    Array<Record<string, unknown>>
  >([])

  // PERF-F8 (#52): keep the AbortController across renders so a
  // pending fetch from the prior `active` graph can be aborted when
  // the user switches graphs faster than the network responds.
  // useRef so we don't trigger an extra render on each .current
  // mutation.
  const inflightAbort = useRef<AbortController | null>(null)
  const effectiveCache = cache ?? defaultSchemaCache

  // GAP-055: dashboard cards now deep-link via /schema?graph=<name>.
  // Read the param once at mount; if it points at a graph the server
  // actually serves, prefer it over the first-graph auto-select. Use
  // `searchParams.get` directly (not in deps) so a later URL change
  // doesn't override an explicit user pick of a different graph in
  // the side picker.
  const [searchParams] = useSearchParams()

  // Initial graph fetch. Empty deps -- runs once on mount. The first
  // returned graph becomes active so the right-hand panes have data,
  // unless the URL pinned a specific graph via ?graph=.
  useEffect(() => {
    let cancelled = false
    const preselect = searchParams.get('graph')
    client
      .graphs({})
      .then((r) => {
        if (cancelled) return
        const list = r?.graphs ?? []
        setGraphs(list)
        if (preselect && list.includes(preselect)) {
          setActive(preselect)
          return
        }
        const first = list[0]
        if (first !== undefined) setActive(first)
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
    // Intentional mount-only: `searchParams` is captured once so a
    // subsequent URL push by a sibling component doesn't re-trigger
    // the server fetch and silently clobber the user's manual graph
    // pick. The repo's eslint config has no react-hooks plugin so an
    // exhaustive-deps disable comment is rejected as unknown.
  }, [])

  // Re-fetch indexes & constraints whenever the active graph changes.
  // PERF-F8: cache check first (instant on re-select), then a single
  // AbortController arms cancellation on the next switch. The generated
  // client does not currently accept a signal so we still gate the
  // setState calls on `signal.aborted` for cancellation correctness;
  // the AbortController also serves as the unambiguous signal that
  // tests assert on (abort() called when graph changes).
  useEffect(() => {
    if (!active) return undefined

    // Cache hit: return instantly with no wire I/O.
    const hit = effectiveCache.getIndexConstraints(active)
    if (hit) {
      setIndexes(hit.indexes)
      setConstraints(hit.constraints)
      return undefined
    }

    // Cache miss: cancel any prior in-flight request, then issue
    // fresh fetches.
    if (inflightAbort.current) {
      inflightAbort.current.abort()
    }
    const controller = new AbortController()
    inflightAbort.current = controller
    const { signal } = controller

    let nextIndexes: Array<Record<string, unknown>> | null = null
    let nextConstraints: Array<Record<string, unknown>> | null = null
    const cachePut = (): void => {
      // Only cache once BOTH requests have settled with a value —
      // a partial result would surface a "ghost half" on the next
      // re-selection.
      if (nextIndexes !== null && nextConstraints !== null && !signal.aborted) {
        effectiveCache.putIndexConstraints(active, {
          indexes: nextIndexes,
          constraints: nextConstraints,
        })
      }
    }

    client
      .indexes({ graph: active })
      .then((r) => {
        if (signal.aborted) return
        nextIndexes = r.indexes ?? []
        setIndexes(nextIndexes)
        cachePut()
      })
      .catch(() => {
        if (signal.aborted) return
        nextIndexes = []
        setIndexes(nextIndexes)
        cachePut()
      })
    client
      .constraints({ graph: active })
      .then((r) => {
        if (signal.aborted) return
        nextConstraints = r.constraints ?? []
        setConstraints(nextConstraints)
        cachePut()
      })
      .catch(() => {
        if (signal.aborted) return
        nextConstraints = []
        setConstraints(nextConstraints)
        cachePut()
      })
    return () => {
      controller.abort()
    }
  }, [active, effectiveCache])

  return (
    <Layout>
      <Pane>
        <h3>{t('schema.graphsTitle')}</h3>
        {err && <p className="text-danger">{err}</p>}
        {graphs.length === 0 && !err && (
          <p className="text-body-tertiary fst-italic">
            {t('schema.noGraphs')}
          </p>
        )}
        <ul className="list-unstyled m-0 p-0 d-flex flex-column gap-1">
          {graphs.map((g) => (
            <li key={g}>
              <GraphBtn $active={g === active} onClick={() => setActive(g)}>
                {g}
              </GraphBtn>
            </li>
          ))}
        </ul>
      </Pane>
      <Pane>
        <h3>
          {active
            ? t('schema.labelsTitleScoped', { graph: active })
            : t('schema.labelsTitle')}
        </h3>
        {active ? (
          <LabelList graph={active} />
        ) : (
          <p className="text-body-tertiary fst-italic">
            {t('schema.selectGraph')}
          </p>
        )}
      </Pane>
      <Pane>
        <h3>
          {active
            ? t('schema.edgeTypesTitleScoped', { graph: active })
            : t('schema.edgeTypesTitle')}
        </h3>
        {active ? (
          <EdgeTypeList graph={active} />
        ) : (
          <p className="text-body-tertiary fst-italic">
            {t('schema.selectGraph')}
          </p>
        )}
        {active && (
          <>
            <h4>{t('schema.indexes')}</h4>
            {indexes.length > 0 ? (
              <Pre>{JSON.stringify(indexes, null, 2)}</Pre>
            ) : (
              <p className="text-body-tertiary fst-italic">
                {t('schema.noIndexes')}
              </p>
            )}
            <h4>{t('schema.constraints')}</h4>
            {constraints.length > 0 ? (
              <Pre>{JSON.stringify(constraints, null, 2)}</Pre>
            ) : (
              <p className="text-body-tertiary fst-italic">
                {t('schema.noConstraints')}
              </p>
            )}
          </>
        )}
      </Pane>
    </Layout>
  )
}
