import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Pre-bundle heavy deps once (esbuild) so the dev server doesn't transform
  // the @tabler/icons-react barrel (thousands of modules) on demand.
  optimizeDeps: {
    include: ['@tabler/icons-react', '@tanstack/react-query', 'react-router-dom'],
  },
  build: {
    rollupOptions: {
      output: {
        // Framework code changes far less often than app code: its own chunk
        // stays cached in browsers across dashboard deploys.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
})
