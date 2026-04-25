import { expect, test } from '@playwright/test';

/**
 * Scope "B" — auth-gated golden path.
 *
 * Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD env vars to be set.
 * When either is missing the whole describe block is skipped so CI
 * can run the smoke suite on PRs without forcing every contributor
 * to own a test account.
 *
 * These tests use a REAL Supabase login against whatever project
 * VITE_SUPABASE_URL points at. They create no DB rows on their own
 * — verifying that a signed-in user reaches the dashboard is enough
 * for this suite. Flows that write test data live in separate specs
 * so we can tear them down cleanly.
 */

const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;

test.describe('auth: sign in reaches the dashboard', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Skipping auth-gated e2e: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run.'
  );

  test('credentials → dashboard', async ({ page }) => {
    await page.goto('/');

    // Wait for the sign-in form. The "checking" auth state briefly
    // renders nothing, so allow up to 15s.
    await expect(page.locator('input#email')).toBeVisible({ timeout: 15_000 });

    await page.locator('input#email').fill(EMAIL!);
    await page.locator('input#password').fill(PASSWORD!);

    // Submit. The button swaps its label between "Sign In" / "Please wait..."
    // / "Sign In Offline" depending on state, so match the submit role instead
    // of exact text.
    await page.getByRole('button', { name: /sign in/i }).click();

    // Successful login navigates to /dashboard. We look for *any* user-visible
    // surface that's only reachable post-auth; using URL assertion is the most
    // stable signal.
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

    // Dashboard has mounted something — not asserting exact copy because
    // the page renders per-user content and will evolve.
    await expect(page.locator('#root')).not.toBeEmpty();
  });
});
