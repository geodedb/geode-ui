// PERF #297: worker URL resolver split into its own module so jest can
// mock it without parsing `import.meta.url` (ts-jest's CommonJS emit
// passes that through and Node rejects it). Mirrors the layoutWorker
// pattern in src/components/results/graph/layoutWorkerUrl.ts.
//
// Webpack 5 statically detects the literal pattern
//   `new Worker(new URL('./queryStreamWorker.ts', import.meta.url), ...)`
// and emits a separate worker bundle. To keep webpack's static
// analysis intact, the call site in queryStream.ts is preserved
// verbatim; this helper exists only as a swap point for the test
// runtime (and to keep `import.meta.url` out of any module path that
// might be evaluated by ts-jest's CommonJS transformer).

export function getQueryStreamWorkerUrl(): URL {
  return new URL('./queryStreamWorker.ts', import.meta.url)
}
