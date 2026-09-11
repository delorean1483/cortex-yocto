import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Pre-bundle heavy deps once (esbuild) so the dev server doesn't transform
  // the @tabler/icons-react barrel (thousands of modules) on demand.
  optimizeDeps: {
    include: ['@tabler/icons-react', '@tanstack/react-query', 'react-router-dom'],
  },
})
