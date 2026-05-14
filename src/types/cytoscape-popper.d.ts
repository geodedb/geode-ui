// cytoscape-popper has its own typings in newer versions, but they
// don't compose cleanly with our cast pattern. Declare as untyped
// so a default import compiles; the consuming hook casts via unknown.
declare module 'cytoscape-popper'
