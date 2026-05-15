import type { PosMap } from './layoutCache'
import { getLayoutWorkerUrl } from './layoutWorkerUrl'

export type NodeSnap = { id: string; data?: Record<string, unknown> }
export type EdgeSnap = { id: string; source: string; target: string }
export type FcoseOpts = Record<string, unknown>

export type RunArgs = {
  nodes: NodeSnap[]
  edges: EdgeSnap[]
  opts: FcoseOpts
  onTick: (positions: PosMap) => void
  onDone: (positions: PosMap) => void
  onFallback: (reason: string) => void
  timeoutMs?: number
}

let workerSingleton: Worker | null = null
let workerDisabledForSession = false
let nextRunId = 1
const watchdogs = new Map<number, ReturnType<typeof setTimeout>>()

function tryCreateWorker(): Worker | null {
  if (workerSingleton) return workerSingleton
  if (workerDisabledForSession) return null
  try {
    workerSingleton = new Worker(getLayoutWorkerUrl(), { type: 'module' })
    workerSingleton.onerror = (): void => {
      workerSingleton?.terminate()
      workerSingleton = null
      workerDisabledForSession = true
    }
    return workerSingleton
  } catch {
    workerDisabledForSession = true
    return null
  }
}

function toPosMap(record: Record<string, [number, number]>): PosMap {
  const m: PosMap = new Map()
  Object.entries(record).forEach(([id, [x, y]]) => m.set(id, { x, y }))
  return m
}

export function runLayoutOnWorker(args: RunArgs): void {
  const w = tryCreateWorker()
  if (!w) {
    args.onFallback('worker-construct-failed')
    return
  }
  const runId = nextRunId
  nextRunId += 1
  const timeoutMs = args.timeoutMs ?? 5000

  const listener = (ev: MessageEvent): void => {
    const msg = ev.data as
      | {
          kind: 'tick'
          runId: number
          positions: Record<string, [number, number]>
        }
      | {
          kind: 'done'
          runId: number
          positions: Record<string, [number, number]>
        }
      | { kind: 'error'; runId: number; message: string }
    if (msg.runId !== runId) return
    if (msg.kind === 'tick') {
      args.onTick(toPosMap(msg.positions))
      return
    }
    clearTimeout(watchdogs.get(runId))
    watchdogs.delete(runId)
    w.removeEventListener('message', listener)
    if (msg.kind === 'error') {
      args.onFallback(`worker-error:${msg.message}`)
      return
    }
    args.onDone(toPosMap(msg.positions))
  }

  w.addEventListener('message', listener)

  const timer = setTimeout(() => {
    w.removeEventListener('message', listener)
    watchdogs.delete(runId)
    try {
      w.terminate()
    } catch {
      /* ignore */
    }
    workerSingleton = null
    args.onFallback('worker-timeout')
  }, timeoutMs)
  watchdogs.set(runId, timer)

  w.postMessage({
    kind: 'run',
    runId,
    nodes: args.nodes,
    edges: args.edges,
    opts: args.opts,
  })
}

// @internal — test seam
// eslint-disable-next-line no-underscore-dangle
export function __resetWorkerForTest(): void {
  try {
    workerSingleton?.terminate()
  } catch {
    /* ignore */
  }
  workerSingleton = null
  workerDisabledForSession = false
  nextRunId = 1
  watchdogs.forEach((t) => clearTimeout(t))
  watchdogs.clear()
}
