import { defineConfig, devices } from '@playwright/test';

/**
 * The demo's browser suite: the production demo build (npm run build:demo),
 * served by Vite's preview, opened in a fresh browser each test. The demo's
 * public-data reads (r2.ciphermaniac.com) are answered empty by the tests, so
 * nothing in the suite leaves the machine.
 */
const PORT = 4382;

export default defineConfig({
  testDir: 'tests/e2e-demo',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', grep: /@mobile/, use: { ...devices['Pixel 7'] } }
  ],
  webServer: {
    command: `npm run build:demo && npx vite preview --config demo/vite.config.ts --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
