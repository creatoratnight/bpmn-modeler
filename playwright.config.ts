import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright end-to-end test configuration.
 *
 * Tests live in `e2e/`. The Vite dev server is started automatically via the
 * `webServer` block below, so `npm run test:e2e` is enough to run the suite.
 *
 * Note: the application initialises Firebase from `src/config/.firebase.js`
 * (gitignored). That file must exist locally for the dev server to boot; the
 * smoke tests here exercise only the pre-authentication screen and need no
 * real credentials.
 */
export default defineConfig({
  testDir: './e2e',
  // Run tests in files in parallel.
  fullyParallel: true,
  // Fail the build on CI if test.only is left in the source.
  forbidOnly: !!process.env.CI,
  // Retry on CI only.
  retries: process.env.CI ? 2 : 0,
  // Opt out of parallel workers on CI.
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    // Dedicated e2e port (see dev:e2e) so the test server is never confused
    // with a normal `npm run dev` on 5173, which would not be in emulator mode.
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment to test other browsers (run `npx playwright install firefox webkit` first).
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  // Start the Vite dev server before running the tests. The `e2e` mode loads
  // .env.e2e, which points the Firebase SDK at the local emulators. The Auth
  // and Database emulators themselves are started by the `test:e2e` /
  // `test:e2e:ui` scripts (firebase emulators:exec), which wrap the Playwright run.
  webServer: {
    command: 'npm run dev:e2e',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
