import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { client } from '../../api/client'
import { useQueryStore } from '../../lib/queryStore'
import { defaultSchemaCache, type SchemaCacheLike } from './schemaCache'

// LabelList renders the node-label set returned by GET
// /api/v1/graphs/{graph}/labels for the active graph. Clicking a label
// stages a `MATCH (n:Label) RETURN n LIMIT 25` statement in the
// queryStore and routes to '/'. QueryPage's mount-effect picks the
// staged statement up and seeds the Monaco editor with it.
//
// Labels are emitted bare (no backticks). Geode v0.5.11 rejects
// backtick-quoted identifiers with `42000: expected identifier or
// keyword, got 'invalid'`. If a future Geode supports backticks AND a
// project starts using labels with reserved characters, revisit.
//
// PERF-2026-05-11-10 (#154): the per-graph label set is served from the
// shared session cache (./schemaCache) — re-selecting a graph the
// operator already visited is instant, zero wire round-trips. On a
// cold miss a fresh AbortController arms cancellation so toggling
// graphs faster than the network responds aborts the stale request
// before it lands a setState. The Geode-side read is a full-graph
// `MATCH (n)` scan; #128 (internal/server/schema_cache.go, 120s TTL) is
// the cold-miss backstop on the server.
//
// The outer `<ul>` is pure layout (vertical flex with theme.spacing.xs
// gap) and renders with Bootstrap utilities: `list-unstyled m-0 p-0
// d-flex flex-column gap-1`. The buttons stay styled-components because
// they own theme.bg.*, theme.text.*, theme.border.*, theme.radii.*, and
// theme.shadows.focus tokens.

// Btn keeps a styled-component: `:hover` swaps both background and
// border tokens, and `:focus-visible` paints `theme.shadows.focus` —
// neither composes cleanly out of Bootstrap utilities.
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

export const LabelList: React.FC<{
  graph: string
  cache?: SchemaCacheLike
}> = ({ graph, cache }) => {
  const { t } = useTranslation()
  const [labels, setLabels] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const setStaged = useQueryStore((s) => s.setStaged)
  const nav = useNavigate()

  // Keep the AbortController across renders so a pending labels fetch
  // from the prior `graph` can be aborted when the operator switches
  // graphs faster than the network responds. The generated client does
  // not currently accept a signal, so we still gate every setState on
  // `signal.aborted`; the AbortController is also the unambiguous
  // signal the regression tests assert on.
  const inflightAbort = useRef<AbortController | null>(null)
  const effectiveCache = cache ?? defaultSchemaCache

  useEffect(() => {
    if (!graph) return undefined

    // Cache hit: hydrate synchronously, no wire I/O.
    const hit = effectiveCache.getLabels(graph)
    if (hit) {
      setLabels(hit)
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
      .labels({ graph })
      .then((r) => {
        if (signal.aborted) return
        const next = r.labels ?? []
        setLabels(next)
        setLoaded(true)
        effectiveCache.putLabels(graph, next)
      })
      .catch(() => {
        // The schema explorer presents an empty pane on failure; the
        // surrounding SchemaExplorer component already has the
        // graph-level error UI, and a transient label-fetch failure is
        // not critical enough to surface a second error path here. We
        // do not cache a failure — the next selection retries.
        if (signal.aborted) return
        setLoaded(true)
      })
    return () => {
      controller.abort()
    }
  }, [graph, effectiveCache])

  if (loaded && labels.length === 0) {
    return (
      <p className="text-body-tertiary fst-italic">{t('schema.noLabels')}</p>
    )
  }

  return (
    <ul className="list-unstyled m-0 p-0 d-flex flex-column gap-1">
      {labels.map((l) => (
        <li key={l}>
          <Btn
            onClick={() => {
              // Prepend `USE GRAPH <graph>;` so the staged query runs
              // against the active graph when the operator clicks Run
              // on the Query page. Without it Geode executes against
              // no graph context and silently returns 0 rows.
              setStaged(
                'USE GRAPH ' + graph + '; MATCH (n:' + l + ') RETURN n LIMIT 25'
              )
              nav('/')
            }}
          >
            {l}
          </Btn>
        </li>
      ))}
    </ul>
  )
}
