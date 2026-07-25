import { defineConfig, devices } from '@playwright/test'

// A3.3 — live-browser E2E for the ungated STR stay-listing wizard (/sell/listing-wizard/stays).
// Boots the isolated .env.test servers with STORAGE_DRIVER=local (real local-disk photo upload) on an
// allowlisted frontend origin (5199 is in server/lib/allowed-origins.mjs — a non-allowlisted port makes
// the browser's cross-origin API calls fail with "Failed to fetch"). Never touches prod or the dev DB.

const API_PORT = 3062
const FRONTEND_PORT = 5199
const API_BASE = `http://127.0.0.1:${API_PORT}`
const FRONTEND_ORIGIN = `http://127.0.0.1:${FRONTEND_PORT}`

export default defineConfig({
  testDir: './test/browser',
  testMatch: 'a3-str-wizard-e2e.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: FRONTEND_ORIGIN,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `node --env-file=.env.test server/index.mjs`,
      port: API_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_PORT: String(API_PORT), API_HOST: '127.0.0.1', NODE_ENV: 'test', STORAGE_DRIVER: 'local', CORS_ORIGIN: FRONTEND_ORIGIN },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${FRONTEND_PORT}`,
      port: FRONTEND_PORT,
      reuseExistingServer: false,
      timeout: 90_000,
      env: { VITE_API_BASE_URL: API_BASE },
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
