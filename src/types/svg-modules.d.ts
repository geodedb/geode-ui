// Webpack's `asset/resource` loader returns the public URL of imported
// images at build time. The default TS lib doesn't ship a module
// declaration for SVG-as-URL imports; this file fills that gap so
// `import logo from './foo.svg'` types as `string`.

declare module '*.svg' {
  const src: string
  export default src
}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.jpg' {
  const src: string
  export default src
}

declare module '*.jpeg' {
  const src: string
  export default src
}

declare module '*.webp' {
  const src: string
  export default src
}

// PERF #316: webpack injects a side-effect-only loader for CSS imports
// inside dynamic `import()` factories. The static-import form was
// untyped before because TS treats bare `import 'foo.css'` as side-
// effect-only; the dynamic `import('foo.css')` form needs an explicit
// module shape for the returned Promise. Empty module — the value is
// never consumed at runtime, only the side effect (style-loader).
declare module '*.css'
