import { expect, type Page } from '@playwright/test';

/**
 * Sign the page in via the real Supabase login form. Returns once the page
 * has navigated to /dashboard. Throws if E2E_TEST_EMAIL or E2E_TEST_PASSWORD
 * are missing — callers should guard with `test.skip` first.
 */
export async function signIn(page: Page): Promise<void> {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'signIn() called without E2E_TEST_EMAIL/E2E_TEST_PASSWORD set. ' +
        'Use `test.skip` upstream to short-circuit auth-gated specs.'
    );
  }

  await page.goto('/');
  await expect(page.locator('input#email')).toBeVisible({ timeout: 15_000 });

  await page.locator('input#email').fill(email);
  await page.locator('input#password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  // /dashboard is the post-sign-in destination for an onboarded account.
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
}
