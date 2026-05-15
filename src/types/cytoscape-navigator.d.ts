// cytoscape-navigator ships as a CommonJS bundle with no TypeScript
// types (see node_modules/cytoscape-navigator/package.json — no "types"
// / "typings" entry). This stub lets the default-import resolve cleanly
// from any file under src/; consumers (GraphMiniMap) cast through
// unknown when wiring it into cytoscape.use().
declare module 'cytoscape-navigator'
