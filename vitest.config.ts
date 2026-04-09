import { defineConfig } from 'vitest/config'

/** Pure TS unit tests � no React plugin (avoids duplicate Vite type trees in `tsc -b`). */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
