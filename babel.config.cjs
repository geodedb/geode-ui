// Babel only transpiles plain .js here: ESM-only node_modules under Jest
// (babel-jest, see jest.config.cjs) and any .js/.jsx in webpack. App
// TypeScript goes through ts-loader / ts-jest, so the former
// babel-plugin-styled-components entry never touched app code; it was
// dropped with the Babel 8 upgrade because it only supports @babel/core 7.
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { esmodules: true } }],
    ['@babel/preset-react', { runtime: 'automatic' }],
    ['@babel/preset-typescript', {}],
  ],
}
