module.exports = {
  preset: 'ts-jest',
  roots: ['<rootDir>/__tests__'],
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: {
          jsx: 'react-jsx',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: true,
          noImplicitAny: false,
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
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@devnw)/)',
  ],
}
