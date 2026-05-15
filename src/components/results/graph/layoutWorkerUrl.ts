// Worker URL resolver — split into its own module so jest can mock it
// without having to parse `import.meta.url` (which ts-jest's CommonJS
// emit passes through and Node then rejects).
//
// Webpack 5 statically detects the literal pattern
//   `new Worker(new URL('./layoutWorker.ts', import.meta.url), ...)`
// and emits a separate worker bundle. To keep webpack's static analysis
// intact, the call site in useLayoutWorker.ts is preserved verbatim;
// this helper only exists as a swap point for the test runtime.

export function getLayoutWorkerUrl(): URL {
  return new URL('./layoutWorker.ts', import.meta.url)
}
