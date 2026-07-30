import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      'server-only': new URL('./tests/mocks/server-only.ts', import.meta.url).pathname,
    },
  },
})
