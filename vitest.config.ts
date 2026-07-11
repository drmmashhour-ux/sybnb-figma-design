import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    // Sequential, not parallel workers: API/security/finance tests share the one local Postgres
    // database via real HTTP requests against an in-process server instance (see
    // test/support/testServer.mjs). Parallel workers would race on the same DB rows.
    fileParallelism: false,
    include: ['test/**/*.test.{ts,mjs}'],
    setupFiles: ['test/support/setup.mjs'],
  },
})
