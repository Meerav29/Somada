import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The SPA is served under /app/ so it can sit next to the legacy page at / until cutover.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  server: {
    // `vercel dev` serves the Python API on :3000
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // Vitest forces Vite's base to '/' while testing, so pin BASE_URL to the real build value.
    env: { BASE_URL: '/app/' },
  },
})
