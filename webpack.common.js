const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin')
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin')
const CopyPlugin = require('copy-webpack-plugin')

const devMode = process.env.NODE_ENV !== 'production'

const plugins = [
  new HtmlWebpackPlugin({
    template: path.resolve(__dirname, 'src', 'index.html'),
    favicon: path.resolve(__dirname, 'public', 'favicon.ico'),
  }),
  new MiniCssExtractPlugin({
    filename: devMode ? '[name].css' : '[name].[contenthash].css',
    chunkFilename: devMode ? '[id].css' : '[id].[contenthash].css',
  }),
  // Bundles monaco-editor and its workers into the SPA build instead of
  // loading from cdn.jsdelivr.net at runtime. Required because our CSP
  // (default-src 'self'; script-src 'self' 'wasm-unsafe-eval') blocks
  // CDN scripts. The custom GQL language is registered at runtime via
  // src/components/editor/gqlLanguage.ts; we only need JSON from the
  // built-ins (for query result inspection) plus core editor features.
  new MonacoWebpackPlugin({
    languages: ['json'],
    filename: devMode ? '[name].worker.js' : '[name].[contenthash].worker.js',
  }),
  // Copies the brand favicon family + PWA manifest under the SPA's
  // public path. The base /favicon.ico is already injected by
  // HtmlWebpackPlugin (above); this widens the set so high-DPI Apple
  // Touch icons, Android Chrome PWA icons, and the manifest itself
  // are reachable from index.html's <link> tags.
  new CopyPlugin({
    patterns: [
      {
        from: path.resolve(__dirname, 'public', 'icons'),
        to: path.resolve(__dirname, 'internal', 'ui', 'dist', 'icons'),
        noErrorOnMissing: true,
      },
      {
        from: path.resolve(__dirname, 'public', 'site.webmanifest'),
        to: path.resolve(
          __dirname,
          'internal',
          'ui',
          'dist',
          'site.webmanifest'
        ),
        noErrorOnMissing: true,
      },
    ],
  }),
]

const rules = [
  {
    test: /\.(ts|tsx)$/,
    use: 'ts-loader',
    exclude: /node_modules/,
  },
  {
    test: /\.(js|jsx)$/,
    use: {
      loader: 'babel-loader',
      options: {
        presets: ['@babel/preset-env', '@babel/preset-react'],
      },
    },
    exclude: /node_modules/,
  },
  {
    test: /\.(s*)css$/,
    use: [devMode ? 'style-loader' : MiniCssExtractPlugin.loader, 'css-loader'],
  },
  {
    test: /\.(png|jp(e*)g|svg|gif)$/i,
    type: 'asset/resource',
  },
  {
    test: /\.(woff(2)?|ttf|eot|otf)(\?v=\d+\.\d+\.\d+)?$/,
    type: 'asset/resource',
  },
]

const SRC_DIR = path.join(__dirname, '/src')
const DIST_DIR = path.join(__dirname, '/internal/ui/dist')

module.exports = {
  stats: { warnings: false },
  plugins,
  module: { rules },
  entry: `${SRC_DIR}/index.tsx`,
  output: {
    filename: devMode ? '[name].js' : '[name].[contenthash].js',
    path: DIST_DIR,
    publicPath: '/',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    alias: {
      'styled-components': path.resolve(
        __dirname,
        'node_modules',
        'styled-components'
      ),
      '@': path.resolve(__dirname, 'src'),
      '@api': path.resolve(__dirname, 'gen/client/react'),
    },
  },
  optimization: {
    minimizer: ['...', new CssMinimizerPlugin()],
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
        },
      },
    },
  },
}
