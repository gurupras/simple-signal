import { defineConfig } from 'vite'
import path from 'path'
import dts from 'vite-plugin-dts'

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'SimpleSignalClient',
      formats: ['es', 'cjs'],
      fileName: (format) => format === 'es' ? 'index.js' : 'index.cjs'
    },
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      external: [
        'simple-peer'
      ],
      output: {
        exports: 'named',
      }
    }
  },
  plugins: [dts({
    tsconfigPath: 'tsconfig.build.json',
    include: ['src']
  })]
})
