// Test stub for src/lib/queryStreamWorkerUrl.ts. The production module
// uses `import.meta.url` to compute the worker URL, which webpack 5
// detects statically to emit a separate worker bundle. ts-jest's
// CommonJS emit doesn't transform `import.meta`, so the production
// file would crash at parse time under jest. This stub replaces it
// for the test runtime — see queryStream.ts: the WS parse worker
// path is gated on `tryCreateParseWorker()` succeeding, and under
// jest the `new Worker(url, ...)` call falls through to the catch
// (jsdom's Worker stub rejects this URL shape), flipping the session
// to the main-thread parse fallback. Tests therefore exercise the
// in-line JSON.parse path exactly as the pre-#297 code did.

module.exports = {
  getQueryStreamWorkerUrl() {
    return 'mock-querystream-worker-url'
  },
}
