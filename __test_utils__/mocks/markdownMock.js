// GAP-061: Jest stub for .md imports. Real Markdown is loaded at
// build time by webpack's asset/source rule (see webpack.common.js);
// tests get a short placeholder string so the import side-effect
// doesn't crash Node's parser on Markdown syntax.
module.exports = '# mock markdown\n\nplaceholder body for tests'
