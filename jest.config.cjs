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
    // ESM-only deps (Web Awesome, Lit, floating-ui) ship raw `import`
    // syntax in their `dist/` files. Jest can't `require()` those without
    // first transpiling them to CommonJS. babel-jest + the project's
    // babel.config.cjs handle that — the negative-lookahead in
    // `transformIgnorePatterns` below allows these packages through.
    '^.+\\.m?js$': 'babel-jest',
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
    // layoutWorkerUrl uses `new URL('./layoutWorker.ts', import.meta.url)`
    // which webpack 5 detects statically to emit a worker bundle. ts-jest
    // emits CJS and doesn't transform `import.meta`, so the production
    // module would crash at parse time. Swap in a stub for tests — the
    // FakeWorker installed by useLayoutWorker.test.ts ignores the URL.
    '(^|/)layoutWorkerUrl$':
      '<rootDir>/__test_utils__/mocks/layoutWorkerUrlMock.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(?:@devnw|@awesome\\.me|lit|lit-html|lit-element|@lit|@floating-ui|@shoelace-style|nanoid)/)',
  ],
}
