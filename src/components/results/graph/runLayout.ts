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

  // Full cache hit — all currentIds have cached positions; apply and return.
  const partial = layoutCache.partialMatch(`${layoutName}|${sig}`, currentIds)
  if (currentIds.length > 0 && partial.matched.length === currentIds.length) {
    applyPositions(cy, partial.positions)
    cy.fit(undefined, 24)
    perfMarks.end('graph:layout')
    onComplete?.()
    return
  }

  // Partial cache hit — if >= 60% of currentIds have cached positions,
  // apply them, lock the matched nodes, run layout on the unlocked subset,
  // then unlock + cache. Cytoscape's `lock`/`unlock` are respected by
  // fcose / cose / dagre — locked nodes don't move.
  if (
    partial.matched.length > 0 &&
    partial.matched.length >= currentIds.length * 0.6
  ) {
    applyPositions(cy, partial.positions)
    const matchedSet = new Set(partial.matched)
    cy.nodes().forEach((node) => {
      if (matchedSet.has(node.id() as string)) {
        const lockable = node as unknown as { lock: () => void }
        lockable.lock()
      }
    })
    mainThreadLayout(cy, layoutName)
    cy.nodes().forEach((node) => {
      const unlockable = node as unknown as { unlock: () => void }
      unlockable.unlock()
    })
    cy.fit(undefined, 24)
    layoutCache.set(`${layoutName}|${sig}`, snapshotPositions(cy))
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
      onTick: (positions) => {
        // P2 progressive reveal: apply intermediate fcose snapshots as
        // they stream in from the worker every ~33ms. applyPositions
        // already runs inside cy.batch() so the render only happens
        // once per tick despite N node writes.
        applyPositions(cy, positions)
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
