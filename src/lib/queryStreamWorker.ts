/// <reference lib="webworker" />

// PERF #297: Web Worker that JSON-parses WS-frame text off the main
// thread. The server already batches up to wsRowBatchSize (64) rows
// per frame, but on a 100k-row stream the ~1,500 main-thread parses
// add up to ~50-150 ms of cumulative blocking time spread across the
// stream — visible as paint hitches in the editor/results region.
//
// Protocol (paired with queryStream.ts):
//   IN  : { kind: 'parse', seq: number, data: string }
//   OUT : { kind: 'parsed', seq: number, msg: unknown }
//         | { kind: 'error', seq: number, message: string }
//
// `seq` is a monotonically-increasing counter assigned by the main
// thread per incoming WS frame. The worker is single-threaded so it
// emits responses in FIFO; the main thread only needs to forward them
// to its onMessage callback as they arrive. No reordering buffer.
//
// Errors are isolated per-frame — a malformed JSON payload returns a
// single `error` envelope so the rest of the stream continues to
// parse. The main thread's caller (streamQuery) currently swallows
// parse failures (matches the pre-worker behaviour); the explicit
// error envelope lets future telemetry instrument them without
// changing the WS contract.

import { camelCaseStreamFrame } from './wireCase'

declare const self: DedicatedWorkerGlobalScope

type WorkerIn = { kind: 'parse'; seq: number; data: string }
type WorkerOut =
  | { kind: 'parsed'; seq: number; msg: unknown }
  | { kind: 'error'; seq: number; message: string }

self.onmessage = (ev: MessageEvent<WorkerIn>): void => {
  const msg = ev.data
  if (!msg || msg.kind !== 'parse') return
  const target = self as unknown as { postMessage(m: WorkerOut): void }
  try {
    // genapi 0.11.1: normalise the row-cell payload snake_case -> camelCase
    // (mirroring the generated client's fromWire on the sync path) here, OFF
    // the main thread, so stream-mode rows match sync-mode rows. Envelope
    // keys (kind / row_count / elapsed_ms) are left untouched.
    const parsed = camelCaseStreamFrame(JSON.parse(msg.data) as unknown)
    target.postMessage({ kind: 'parsed', seq: msg.seq, msg: parsed })
  } catch (e) {
    target.postMessage({
      kind: 'error',
      seq: msg.seq,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

export {}
