import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { client } from '../../api/client'
import { useQueryStore } from '../../lib/queryStore'
import { defaultSchemaCache, type SchemaCacheLike } from './schemaCache'

// EdgeTypeList mirrors LabelList for relationship types. Clicking a
// type stages a `MATCH ()-[r:Type]->() RETURN r LIMIT 25` statement
// and navigates to '/'. The LIMIT 25 keeps the preview cheap on large
// graphs; the user can edit before running. Identifiers are emitted
// bare — Geode v0.5.11 rejects backtick-quoted form (42000).
//
// PERF-2026-05-11-10 (#154): the per-graph edge-type set is served from
// the shared session cache (./schemaCache) — re-selecting a graph the
// operator already visited is instant, zero wire round-trips. On a cold
// miss a fresh AbortController arms cancellation so toggling graphs
// faster than the network responds aborts the stale request before it
// lands a setState. The Geode-side read is a full-graph
// `MATCH ()-[r]->()` scan; #128 (internal/server/schema_cache.go, 120s
// TTL) is the cold-miss backstop on the server.
//
// The outer `<ul>` is pure layout (vertical flex with theme.spacing.xs
// gap) and renders with Bootstrap utilities: `list-unstyled m-0 p-0
// d-flex flex-column gap-1`. The buttons stay styled-components because
// they own theme.bg.*, theme.text.*, theme.border.*, theme.radii.*, and
// theme.shadows.focus tokens.

// Btn keeps a styled-component: `:hover` swaps both background and
// border tokens, and `:focus-visible` paints `theme.shadows.focus` —
// neither is expressible in Bootstrap utilities (focus-ring-* and
// hover-bg-* don't compose to the same effect against our surface
// tokens).
const Btn = styled.button`
  text-align: left;
  padding: 8px 12px;
  min-height: 36px;
  background: ${({ theme }) => theme.bg.surface};
  color: ${({ theme }) => theme.text.primary};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  cursor: pointer;
  font-family: inherit;
  font-size: ${({ theme }) => theme.font.sizes.md};

  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
    border-color: ${({ theme }) => theme.border.default};
  }

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

export const EdgeTypeList: React.FC<{
  graph: string
  cache?: SchemaCacheLike
}> = ({ graph, cache }) => {
  const { t } = useTranslation()
  const [types, setTypes] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const setStaged = useQueryStore((s) => s.setStaged)
  const nav = useNavigate()

  // Keep the AbortController across renders so a pending edge-types
  // fetch from the prior `graph` can be aborted on a fast graph switch.
  // The generated client does not accept a signal; we still gate every
  // setState on `signal.aborted` and the controller doubles as the
  // signal the regression tests assert on.
  const inflightAbort = useRef<AbortController | null>(null)
  const effectiveCache = cache ?? defaultSchemaCache

  useEffect(() => {
    if (!graph) return undefined

    // Cache hit: hydrate synchronously, no wire I/O.
    const hit = effectiveCache.getEdgeTypes(graph)
    if (hit) {
      setTypes(hit)
      setLoaded(true)
      return undefined
    }

    // Cache miss: cancel any prior in-flight request, then fetch.
    if (inflightAbort.current) inflightAbort.current.abort()
    const controller = new AbortController()
    inflightAbort.current = controller
    const { signal } = controller

    setLoaded(false)
    client
      .edgeTypes({ graph })
      .then((r) => {
        if (signal.aborted) return
        const next = r.types ?? []
        setTypes(next)
        setLoaded(true)
        effectiveCache.putEdgeTypes(graph, next)
      })
      .catch(() => {
        // We do not cache a failure — the next selection retries.
        if (signal.aborted) return
        setLoaded(true)
      })
    return () => {
      controller.abort()
    }
  }, [graph, effectiveCache])

  if (loaded && types.length === 0) {
    return (
      <p className="text-body-tertiary fst-italic">{t('schema.noEdgeTypes')}</p>
    )
  }

  return (
    <ul className="list-unstyled m-0 p-0 d-flex flex-column gap-1">
      {types.map((t) => (
        <li key={t}>
          <Btn
            onClick={() => {
              // Prepend `USE GRAPH <graph>;` so the staged query runs
              // against the active graph when the operator clicks Run.
              // Without it Geode executes against no graph context
              // and silently returns 0 rows.
              //
              // GAP-057: project the endpoint NODES (n, m) alongside
              // the edge (r) so the graph view can render their type
              // labels. Pre-fix the query projected `r` only, which
              // returned edges with `start_node`/`end_node` numeric
              // IDs but no node info — pushPlaceholderNodes then
              // labelled every endpoint "#<id>" because both the type
              // label and display label maps missed. The edge tab
              // entry point exists to surface "which node types this
              // edge connects" (Person -[ACTED_IN]-> Movie); the
              // n + m projection makes that contract observable.
              setStaged(
                'USE GRAPH ' +
                  graph +
                  '; MATCH (n)-[r:' +
                  t +
                  ']->(m) RETURN n, r, m LIMIT 25'
              )
              nav('/')
            }}
          >
            {t}
          </Btn>
        </li>
      ))}
    </ul>
  )
}
