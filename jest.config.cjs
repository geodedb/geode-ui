module.exports = {
  preset: 'ts-jest',
  roots: ['<rootDir>/__tests__', '<rootDir>/src'],
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: true,
          isolatedModules: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: true,
          moduleResolution: 'node',
          module: 'commonjs',
          target: 'es2015',
        },
      },
    ],
  },
  setupFilesAfterEnv: ['<rootDir>/__test_utils__/afterEnv.js'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  setupFiles: ['<rootDir>/__test_utils__/polyfills.js'],
  moduleNameMapper: {
    '^.+\\.(css|less|sass|scss)$':
      '<rootDir>/__test_utils__/mocks/styleMock.js',
    '^.+\\.(jpg|jpeg|png|gif|webp|avif|svg|eot|otf|ttf|woff|woff2)$':
      '<rootDir>/__test_utils__/mocks/fileMock.js',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@api$': '<rootDir>/gen/client/react/index.ts',
    '^@api/(.*)$': '<rootDir>/gen/client/react/$1',
    // cytoscape-lasso's package.json `main` points at src/index.js (raw
    // ESM). Jest can't parse `import` without transforming it, so for
    // tests we hop straight to the UMD/CJS dist build. The runtime app
    // (esbuild/vite) handles the ESM source path normally.
    '^cytoscape-lasso$':
      '<rootDir>/node_modules/cytoscape-lasso/dist/cytoscape-lasso.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@devnw)/)',
  ],
}
