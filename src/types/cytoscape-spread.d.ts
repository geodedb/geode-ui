// cytoscape-spread ships no TypeScript types (no `types` / `typings`
// entry in node_modules/cytoscape-spread/package.json). Declare it as
// an untyped module so a default import resolves cleanly from any file
// under src/; consumers cast through unknown when wiring it into
// cytoscape.use().
declare module 'cytoscape-spread'
