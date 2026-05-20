// GAP-061: ambient module for .md imports. webpack.common.js loads
// every .md file via `type: 'asset/source'`, which returns the raw
// file contents as a string. TypeScript otherwise refuses the import
// because it has no resolver for the .md extension.
declare module '*.md' {
  const content: string
  export default content
}
