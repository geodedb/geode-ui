const path = require('path')
const { merge } = require('webpack-merge')
const common = require('./webpack.common.js')

module.exports = merge(common, {
  mode: 'development',
  devtool: 'inline-source-map',
  devServer: {
    historyApiFallback: true,
    static: {
      directory: path.join(__dirname, './public'),
    },
    port: 3000,
    hot: true,
    open: true,
    proxy: [
      {
        context: ['/api'],
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      {
        context: ['/ws'],
        target: 'ws://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
      {
        context: ['/mcp'],
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      {
        context: ['/healthz'],
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    ],
  },
})
