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
    // GAP-061: in-app docs viewer imports .md files via webpack's
    // asset/source rule (see webpack.common.js). Jest can't parse the
    // raw Markdown as JS, so swap in a stub that exports a short
    // placeholder string. Tests that need real Markdown rendering
    // import the renderer directly with hand-written source.
    '^.+\\.md$': '<rootDir>/__test_utils__/mocks/markdownMock.js',
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
    // Same pattern for the WS-parse worker URL (PERF #297). queryStream
    // tests rely on the synchronous main-thread parse fallback that
    // engages when `new Worker(url, …)` fails — the stub keeps the URL
    // resolver from crashing at parse time so the rest of the module
    // loads cleanly.
    '(^|/)queryStreamWorkerUrl$':
      '<rootDir>/__test_utils__/mocks/queryStreamWorkerUrlMock.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(?:@devnw|@awesome\\.me|lit|lit-html|lit-element|@lit|@floating-ui|@shoelace-style|nanoid)/)',
  ],
  // QUALITY #48 / GAP-019: ratcheted coverage thresholds. Set to the
  // current measured floor minus 1 pp so a micro-regression (a
  // pre-existing test deleted or a freshly-merged feature shipping
  // without a unit test) fails the gate without producing flake on
  // the green path. Refresh the floor in a follow-up commit when a
  // deliberate coverage push lands.
  //
  // Today's measured floor (2026-05-16, 773 tests across 118 suites):
  //   statements 80.32 -> 79
  //   branches   67.80 -> 66
  //   functions  75.60 -> 74
  //   lines      82.48 -> 81
  coverageThreshold: {
    global: {
      statements: 79,
      branches: 66,
      functions: 74,
      lines: 81,
    },
  },
}
