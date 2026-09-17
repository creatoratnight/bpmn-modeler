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
      // The default testMatch (*.spec.ts) excludes the *.shots.ts capture file.
      // The collaboration test and the demo choreography manage their own (headed,
      // multi-window) browsers and are heavy/opt-in, so they are excluded from the
      // default run (see `npm run test:collab` / `npm run demo`).
      testIgnore: ['**/collaboration.spec.ts', '**/demo-vergunningsaanvraag.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },

    // Two-client real-time collaboration + database data-rate test. Run via
    // `npm run test:collab`. Launches its own side-by-side headed windows (set
    // HEADLESS=1 to run without them) and writes a report under e2e/.collab-report/.
    {
      name: 'collab',
      testMatch: '**/collaboration.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // Four-user demo choreography for screen-recording a live-collaboration video.
    // Launches its own four tiled, headed windows. Run via `npm run demo`.
    {
      name: 'demo',
      testMatch: '**/demo-vergunningsaanvraag.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },

    // Uncomment to test other browsers (run `npx playwright install firefox webkit` first).
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },

    // Documentation screenshots — run via `npm run screenshots`, not part of the
    // normal test run. A larger viewport produces nicer doc images.
    {
      name: 'screenshots',
      testMatch: '**/screenshots/**/*.shots.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
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
