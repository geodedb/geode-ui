/// <reference lib="webworker" />

// Web Worker entry. Runs fcose against a node/edge topology and posts
// final positions back. P1 does NOT emit per-tick snapshots — that
// lands in P2 (T20).

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

type WorkerOut =
  | { kind: 'done'; runId: number; positions: Record<string, [number, number]> }
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

    layout.one('layoutstop', () => {
      if (currentRunId !== msg.runId) {
        cy.destroy()
        return
      }
      const positions: Record<string, [number, number]> = {}
      cy.nodes().forEach((n) => {
        const p = n.position()
        positions[n.id()] = [p.x, p.y]
      })
      const out: WorkerOut = { kind: 'done', runId: msg.runId, positions }
      const target = self as unknown as { postMessage(m: WorkerOut): void }
      target.postMessage(out)
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
