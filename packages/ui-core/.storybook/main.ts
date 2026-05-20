import type { StorybookConfig } from '@storybook/react-webpack5'
import type { Configuration } from 'webpack'

const config: StorybookConfig = {
  stories: [
    '../stories/**/*.mdx',
    '../src/**/*.stories.@(ts|tsx|mdx)',
  ],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-links',
  ],
  framework: {
    name: '@storybook/react-webpack5',
    options: {},
  },
  typescript: {
    check: false,
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      shouldRemoveUndefinedFromOptional: true,
      propFilter: (prop) => (prop.parent ? !/node_modules/.test(prop.parent.fileName) : true),
    },
  },
  docs: { autodocs: 'tag' },
  // Inject a Babel loader for TypeScript/TSX files so the Webpack5 builder
  // can parse `import type` syntax in .storybook/preview.tsx and story files.
  // Also sets output.publicPath from STORYBOOK_BASE_URL so the build works
  // when served from a subpath (e.g. GitLab Pages at /<project>/storybook/).
  webpackFinal: async (webpackConfig: Configuration) => {
    webpackConfig.module = webpackConfig.module ?? { rules: [] }
    webpackConfig.module.rules = webpackConfig.module.rules ?? []
    webpackConfig.module.rules.push({
      test: /\.(ts|tsx)$/,
      exclude: /node_modules/,
      use: {
        loader: 'babel-loader',
        options: { configFile: true },
      },
    })

    // Honour STORYBOOK_BASE_URL for subpath deployments (e.g., GitLab Pages
    // at /<project>/storybook/). When unset, falls back to '/' which is
    // correct for `storybook dev` and root-served builds.
    const baseUrl = process.env.STORYBOOK_BASE_URL || '/'
    webpackConfig.output = webpackConfig.output || {}
    webpackConfig.output.publicPath = baseUrl

    return webpackConfig
  },
}

export default config
