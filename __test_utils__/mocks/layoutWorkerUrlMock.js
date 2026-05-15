// Test stub for ./layoutWorkerUrl. The production module uses
// `import.meta.url` to compute the worker URL, which webpack 5 detects
// statically. ts-jest's CommonJS emit doesn't transform `import.meta`,
// so the production file would crash at parse time under jest. This
// stub replaces it for the test runtime — the FakeWorker installed by
// individual tests ignores the URL anyway.

module.exports = {
  getLayoutWorkerUrl() {
    return 'mock-layout-worker-url'
  },
}
