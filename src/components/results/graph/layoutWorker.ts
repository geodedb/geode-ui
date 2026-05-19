/// <reference lib="webworker" />

// Web Worker entry. Runs fcose against a node/edge topology and posts
// per-tick position snapshots (every 33 ms) plus a final `done` message
// at terminal `layoutstop`.

import cytoscape from 'cytoscape'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — cytoscape-fcose has no DOM dependency and is safe in workers
import fcose from 'cytoscape-fcose'

declare const self: DedicatedWorkerGlobalScope

cytoscape.use(fcose)

type NodeSnap = { id: string; data?: Record<string, unknown> }
type EdgeSnap = { id: string; source: string; target: string }
type FcoseOpts = Record<string, unknown>

type WorkerIn =
  | {
      kind: 'run'
      runId: number
      nodes: NodeSnap[]
      edges: EdgeSnap[]
      opts: FcoseOpts
    }
  | { kind: 'cancel'; runId: number }

// PERF #291: the tick/done message carries positions as a flat
// Float32Array (length = 2 * N, packed [x0, y0, x1, y1, …]) instead
// of a `Record<string, [number, number]>`. The order of positions
// matches the order of `nodes` in the original `run` message — cy
// iterates nodes in insertion order, and the worker inserts nodes
// from msg.nodes in array order. The main thread closes over the
// input nodes to recover the id-by-index mapping (useLayoutWorker
// .toPosMap), so no id metadata needs to round-trip per tick.
//
// Why: at n=10000 the pre-fix tick emitted a fresh object literal +
// N 2-tuple arrays every 33 ms (~30 Hz × 10k = 300k allocs/s during
// convergence), plus the structured-clone walk for the
// postMessage. The Float32Array is a single 80 KB block transferred
// via the postMessage transfer list — zero copy, one allocation
// reused per tick is impractical because the worker's caller may
// consume the buffer on its own timeline, so we still allocate per
// tick but it's a single bulk allocation instead of N small ones.
type WorkerOut =
  | { kind: 'tick'; runId: number; positions: Float32Array }
  | { kind: 'done'; runId: number; positions: Float32Array }
  | { kind: 'error'; runId: number; message: string }

let currentRunId: number | null = null

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data
  if (msg.kind === 'cancel') {
    if (msg.runId === currentRunId) currentRunId = null
    return
  }
  if (msg.kind !== 'run') return

  currentRunId = msg.runId

  try {
    const cy = cytoscape({
      headless: true,
      styleEnabled: false,
      elements: [
        ...msg.nodes.map((n) => ({
          group: 'nodes' as const,
          data: { id: n.id, ...n.data },
        })),
        ...msg.edges.map((e) => ({
          group: 'edges' as const,
          data: { id: e.id, source: e.source, target: e.target },
        })),
      ],
    })

    const layout = cy.layout({
      name: 'fcose',
      ...msg.opts,
      animate: false,
      fit: false,
    } as unknown as cytoscape.LayoutOptions)

    // PERF #291: pack positions into a flat Float32Array per emission.
    // The caller (useLayoutWorker.toPosMap) iterates its own copy of
    // msg.nodes in the same order to map index → id, so we don't ship
    // any id metadata per tick.
    const n = msg.nodes.length
    const packPositions = (): Float32Array => {
      const out = new Float32Array(n * 2)
      let i = 0
      cy.nodes().forEach((node) => {
        const p = node.position()
        // Defensive bound: cy may have ended up with more/fewer nodes
        // if the worker's cytoscape constructor dedupes ids. Clamp
        // writes to the pre-allocated buffer so we never overflow.
        if (i < n * 2) {
          out[i] = p.x
          out[i + 1] = p.y
          i += 2
        }
      })
      return out
    }
    const postPositions = (kind: 'tick' | 'done'): void => {
      const positions = packPositions()
      const out: WorkerOut = { kind, runId: msg.runId, positions }
      const target = self as unknown as {
        postMessage(m: WorkerOut, transfer?: Transferable[]): void
      }
      // Transfer the buffer so the postMessage round-trip is zero-copy.
      // After transfer, the worker can no longer access `positions` —
      // that's fine, this function recreates a fresh array each call.
      target.postMessage(out, [positions.buffer])
    }
    let stopped = false
    const tickInterval = setInterval(() => {
      if (stopped || currentRunId !== msg.runId) return
      postPositions('tick')
    }, 33)

    layout.one('layoutstop', () => {
      stopped = true
      clearInterval(tickInterval)
      if (currentRunId !== msg.runId) {
        cy.destroy()
        return
      }
      postPositions('done')
      cy.destroy()
    })

    layout.run()
  } catch (e) {
    const out: WorkerOut = {
      kind: 'error',
      runId: msg.runId,
      message: e instanceof Error ? e.message : String(e),
    }
    const target = self as unknown as { postMessage(m: WorkerOut): void }
    target.postMessage(out)
  }
}

export {}
