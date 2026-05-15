import type { Core } from 'cytoscape'
import { perfMarks } from '../../../lib/perfMarks'
import { layoutCache, type PosMap } from './layoutCache'
import { runLayoutOnWorker } from './useLayoutWorker'
import { layoutConfig } from './layouts'
import type { LayoutName } from '../useGraphPrefs'

const WORKER_MIN_N = 200

export type RunLayoutArgs = {
  cy: Core
  layoutName: LayoutName
  sig: string
  currentIds: string[]
  n: number
  useWorker: boolean
  onComplete?: () => void
}

export function applyPositions(cy: Core, positions: PosMap): void {
  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const p = positions.get(node.id() as string)
      if (p) node.position(p)
    })
  })
}

function snapshotPositions(cy: Core): PosMap {
  const map: PosMap = new Map()
  cy.nodes().forEach((n) => {
    const p = n.position()
    map.set(n.id() as string, { x: p.x, y: p.y })
  })
  return map
}

function mainThreadLayout(cy: Core, layoutName: LayoutName): void {
  cy.layout(layoutConfig(layoutName)).run()
}

export function runLayout(args: RunLayoutArgs): void {
  const { cy, layoutName, sig, currentIds, n, useWorker, onComplete } = args
  perfMarks.start('graph:layout')

  // Full cache hit — apply and return.
  const cached = layoutCache.get(`${layoutName}|${sig}`)
  if (cached.hit === 'full' && cached.positions) {
    applyPositions(cy, cached.positions)
    cy.fit(undefined, 24)
    perfMarks.end('graph:layout')
    onComplete?.()
    return
  }

  // Worker path — fcose, large enough, user pref on.
  if (useWorker && layoutName === 'fcose' && n >= WORKER_MIN_N) {
    const nodes = currentIds.map((id) => ({ id }))
    const edges: { id: string; source: string; target: string }[] = []
    cy.edges().forEach((e) => {
      edges.push({
        id: e.id() as string,
        source: e.source().id() as string,
        target: e.target().id() as string,
      })
    })
    runLayoutOnWorker({
      nodes,
      edges,
      opts: {},
      onTick: () => {
        // No-op in P1 — per-tick reveal lands in P2 (T21).
      },
      onDone: (positions) => {
        applyPositions(cy, positions)
        cy.fit(undefined, 24)
        layoutCache.set(`${layoutName}|${sig}`, positions)
        perfMarks.end('graph:layout')
        onComplete?.()
      },
      onFallback: () => {
        mainThreadLayout(cy, layoutName)
        layoutCache.set(`${layoutName}|${sig}`, snapshotPositions(cy))
        perfMarks.end('graph:layout')
        onComplete?.()
      },
    })
    return
  }

  // Main-thread fallback path — non-fcose layout, small n, or worker off.
  mainThreadLayout(cy, layoutName)
  layoutCache.set(`${layoutName}|${sig}`, snapshotPositions(cy))
  perfMarks.end('graph:layout')
  onComplete?.()
}
