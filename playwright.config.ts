import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the real server, web app and a deterministic mock
 * Home Assistant on dedicated ports, against the separate test database.
 * No physical hardware is required.
 */
const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://smartnest:smartnest@localhost:5442/smartnest_test?schema=public';
const API_PORT = 4318;
const WEB_PORT = 5318;
const MOCK_HA_PORT = 8129;

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /responsive.spec.ts/ },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'npx tsx apps/mock-ha/src/index.ts',
      port: MOCK_HA_PORT,
      env: { MOCK_HA_PORT: String(MOCK_HA_PORT) },
      reuseExistingServer: false,
    },
    {
      command: 'npx prisma migrate deploy --schema apps/server/prisma/schema.prisma && npx tsx apps/server/src/index.ts',
      url: `http://localhost:${API_PORT}/api/health`,
      env: {
        NODE_ENV: 'development',
        DATABASE_URL: TEST_DB,
        PORT: String(API_PORT),
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        PUBLIC_APP_URL: `http://localhost:${WEB_PORT}`,
        COMMAND_TIMEOUT_MS: '6000',
        LOG_LEVEL: 'warn',
      },
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: 'apps/web',
      port: WEB_PORT,
      env: { SMARTNEST_API_URL: `http://localhost:${API_PORT}` },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});

export const E2E = { MOCK_HA_URL: `http://127.0.0.1:${MOCK_HA_PORT}`, MOCK_HA_TOKEN: 'mock-long-lived-access-token-for-tests-0000' };
