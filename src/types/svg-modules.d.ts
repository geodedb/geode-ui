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
