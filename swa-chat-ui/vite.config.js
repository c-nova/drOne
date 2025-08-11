import { defineConfig } from 'vite'
import { Buffer } from 'buffer'

export default defineConfig({
  build: {
    outDir: 'dist'
  },
  server: {
    port: 3000
  },
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['buffer']
  },
  resolve: {
    alias: {
      buffer: 'buffer'
    }
  }
})
