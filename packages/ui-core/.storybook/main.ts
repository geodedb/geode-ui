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
  // Honour STORYBOOK_PUBLIC_PATH when deploying to a GitLab Pages subdirectory.
  // The CI job sets it to `/${CI_PROJECT_NAME}/` so asset URLs resolve correctly.
  managerHead: (head) => `${head}`,
  // Inject a Babel loader for TypeScript/TSX files so the Webpack5 builder
  // can parse `import type` syntax in .storybook/preview.tsx and story files.
  webpackFinal: async (webpackConfig: Configuration) => {
    webpackConfig.module = webpackConfig.module ?? { rules: [] }
    webpackConfig.module.rules = webpackConfig.module.rules ?? []
    webpackConfig.module.rules.push({
      test: /\.[jt]sx?$/,
      exclude: /node_modules/,
      use: {
        loader: 'babel-loader',
        options: {
          presets: [
            ['@babel/preset-env', { targets: { browsers: ['last 2 versions'] } }],
            ['@babel/preset-react', { runtime: 'automatic' }],
            '@babel/preset-typescript',
          ],
        },
      },
    })
    return webpackConfig
  },
}

export default config
