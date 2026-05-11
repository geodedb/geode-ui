import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { client } from '../../api/client'
import type { Theme } from '../../theme'
import { below } from '../../theme'
import { LabelList } from './LabelList'
import { EdgeTypeList } from './EdgeTypeList'

// PERF-F8 (#52): per-graph cache for the index+constraint pair so
// re-selecting a graph the user has already viewed during this
// session is instant — no second wire round-trip. Capped at
// schemaCacheMaxEntries to avoid unbounded growth in long-lived
// sessions; eviction is FIFO via insertion-order iteration over the
// Map keys, which is well-defined per ECMAScript spec.
type SchemaCacheEntry = {
  indexes: Array<Record<string, unknown>>
  constraints: Array<Record<string, unknown>>
}
const schemaCacheMaxEntries = 8

// SchemaExplorerCache is exported as a small interface so tests can
// inject a fresh cache (one per test) without having to reset
// module-level state.
export interface SchemaExplorerCacheLike {
  get(graph: string): SchemaCacheEntry | undefined
  put(graph: string, entry: SchemaCacheEntry): void
  size(): number
}

export function createSchemaExplorerCache(
  maxEntries: number = schemaCacheMaxEntries
): SchemaExplorerCacheLike {
  const map = new Map<string, SchemaCacheEntry>()
  return {
    get(graph) {
      return map.get(graph)
    },
    put(graph, entry) {
      // Reset insertion order to make re-hit promote to most-recent.
      if (map.has(graph)) map.delete(graph)
      map.set(graph, entry)
      // Evict oldest while over capacity.
      while (map.size > maxEntries) {
        const firstKey = map.keys().next().value
        if (firstKey === undefined) break
        map.delete(firstKey)
      }
    },
    size() {
      return map.size
    },
  }
}

// Module-level default cache. Lives across component remounts so a
// user navigating away and back gets the cached result. Tests should
// inject a fresh cache via the optional `cache` prop.
const defaultSchemaCache = createSchemaExplorerCache()

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

const GraphList = styled.ul`
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
  padding: 0;
  margin: 0;
`

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

const Empty = styled.p`
  color: ${({ theme }) => theme.text.muted};
  font-style: italic;
`

const ErrText = styled.p`
  color: ${({ theme }) => theme.text.danger};
`

// SchemaExplorerProps lets tests inject a fresh cache instance per
// run; production callers omit the prop and inherit the module-level
// defaultSchemaCache.
export type SchemaExplorerProps = {
  cache?: SchemaExplorerCacheLike
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

  // Initial graph fetch. Empty deps -- runs once on mount. The first
  // returned graph becomes active so the right-hand panes have data.
  useEffect(() => {
    let cancelled = false
    client
      .graphs({})
      .then((r) => {
        if (cancelled) return
        const list = r?.graphs ?? []
        setGraphs(list)
        const first = list[0]
        if (first !== undefined) setActive(first)
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
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
    const hit = effectiveCache.get(active)
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
        effectiveCache.put(active, {
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
        {err && <ErrText>{err}</ErrText>}
        {graphs.length === 0 && !err && <Empty>{t('schema.noGraphs')}</Empty>}
        <GraphList>
          {graphs.map((g) => (
            <li key={g}>
              <GraphBtn $active={g === active} onClick={() => setActive(g)}>
                {g}
              </GraphBtn>
            </li>
          ))}
        </GraphList>
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
          <Empty>{t('schema.selectGraph')}</Empty>
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
          <Empty>{t('schema.selectGraph')}</Empty>
        )}
        {active && (
          <>
            <h4>{t('schema.indexes')}</h4>
            {indexes.length > 0 ? (
              <Pre>{JSON.stringify(indexes, null, 2)}</Pre>
            ) : (
              <Empty>{t('schema.noIndexes')}</Empty>
            )}
            <h4>{t('schema.constraints')}</h4>
            {constraints.length > 0 ? (
              <Pre>{JSON.stringify(constraints, null, 2)}</Pre>
            ) : (
              <Empty>{t('schema.noConstraints')}</Empty>
            )}
          </>
        )}
      </Pane>
    </Layout>
  )
}
