import { defineConfig } from 'tsup'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'theme/index': 'src/theme/index.ts',
    'hooks/index': 'src/hooks/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: ['react', 'react-dom', 'styled-components'],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  async onSuccess() {
    const src = 'src/styles/bootstrap-bridge.css'
    const dest = 'dist/styles/bootstrap-bridge.css'
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(src, dest)
  },
})
