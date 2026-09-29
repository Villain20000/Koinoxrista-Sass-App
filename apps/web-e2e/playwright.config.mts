import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

// For CI, you may want to set BASE_URL to the deployed application.
const baseURL = process.env['BASE_URL'] || 'http://localhost:4200';

const stateDir = `${workspaceRoot}/dist/.playwright/apps/web-e2e/states`;

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import 'dotenv/config';

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * Generated as a .mts file so Node forces ESM regardless of workspace
 * `type`. Playwright routes `.mts` through its ESM loader (dynamic import,
 * bypassing the pirates CJS-compile path), and Nx's native TS strip loads
 * `.mts` directly. Playwright's configLoader auto-discovers
 * `playwright.config.mts` via its extension list
 * (.ts/.js/.mts/.mjs/.cts/.cjs).
 */
export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  /* Run your local dev server before starting the tests */
  webServer: {
    // The web dev server proxies /api to :3000, so both apps must run.
    command: 'pnpm exec nx run-many -t serve -p api web',
    url: 'http://localhost:4200',
    reuseExistingServer: true,
    cwd: workspaceRoot,
    timeout: 120_000,
  },
  projects: [
    // Logs in once per role; the HttpOnly refresh cookie is saved to
    // storageState so the role projects restore the session without
    // hitting the auth throttle (10 logins/min).
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium-admin',
      testMatch: /admin-modules\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: `${stateDir}/admin.json`,
      },
      dependencies: ['setup'],
    },
    {
      name: 'chromium-resident',
      testMatch: /resident\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: `${stateDir}/resident.json`,
      },
      dependencies: ['setup'],
    },
    // Tests the login flow itself, so it needs a clean context.
    {
      name: 'chromium-login',
      testMatch: /login\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
});
