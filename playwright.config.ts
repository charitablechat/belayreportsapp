import { defineConfig, devices } from '@playwright/test';
import { loadEnv } from 'vite';

// Surface VITE_* values from .env into process.env so the test files (running
// in Node, not in the browser bundle) can talk to Supabase directly for
// pre-flight cleanup and post-flight verification.
const viteEnv = loadEnv('production', process.cwd(), 'VITE_');
for (const [k, v] of Object.entries(viteEnv)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

/**
 * Playwright configuration for the Ropeworks PWA.
 *
 * Two test scopes:
 * - smoke (`tests/e2e/smoke/**`)        — no auth, no creds. Always runs in CI.
 * - auth-gated (`tests/e2e/auth/**`)    — needs E2E_TEST_EMAIL and
 *                                         E2E_TEST_PASSWORD env vars. Skipped
 *                                         in CI when those vars are absent.
 *
 * The runner spawns its own `vite` dev server on http://127.0.0.1:4173
 * (separate port from local `bun run dev` to avoid clobbering an
 * already-running dev server).
 *
 * Verified via `bunx playwright test` exit code only — no interactive UI
 * verification expected.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Only Playwright specs use `*.spec.ts`. Any `*.test.ts` under `tests/e2e/`
  // (e.g. `_fixtures/transient-retry.test.ts`) is a vitest unit test for a
  // pure helper — those are picked up by `vitest.config.ts` and must NOT be
  // imported by the Playwright runner. Importing a vitest file inside
  // Playwright transitively loads `@vitest/expect`, which redefines
  // `Symbol($$jest-matchers-object)` and crashes Playwright's own expect
  // before any spec runs (`TypeError: Cannot redefine property: ...`).
  testMatch: /.*\.spec\.ts$/,
  // Fail the build on any `test.only(...)` left in source.
  forbidOnly: !!process.env.CI,
  // CI gets one retry; local gets none so flake doesn't hide.
  retries: process.env.CI ? 1 : 0,
  // CI runs serially for predictability; local can parallelize.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Auto-start the app for local + CI runs. Skipped if E2E_BASE_URL is set
  // (so we can also point Playwright at a deployed preview URL).
  //
  // `vite preview` serves from `dist/`, which means it crashes on a fresh
  // checkout with no prior build. Run `vite build` first so the command
  // succeeds regardless of the current state of `dist/`. On an already-built
  // tree this is a no-op rebuild (~20s on CI).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command:
          'bun run build && bun run preview -- --port 4173 --strictPort',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        // Cold GitHub runners can exceed 180s while building the app before
        // `vite preview` starts. Keep the job-level cap at 8 minutes, but give
        // Playwright enough startup headroom so the smoke job does not fail
        // before the preview server has a chance to boot.
        timeout: 360_000,
      },
});
