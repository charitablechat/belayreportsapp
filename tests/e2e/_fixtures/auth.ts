import { expect, type Page } from '@playwright/test';

export interface SignInOpts {
  /** Override the default E2E_TEST_EMAIL/PASSWORD env-pair with explicit creds. */
  email?: string;
  password?: string;
}

/**
 * Sign the page in via the real Supabase login form. Returns once the page
 * has navigated to /dashboard. Throws if no credentials are available —
 * callers should guard with `test.skip` first.
 *
 * Default credentials come from `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`. Pass
 * `opts` to use a different identity (e.g. an admin user for multi-role specs).
 */
export async function signIn(page: Page, opts: SignInOpts = {}): Promise<void> {
  const email = opts.email ?? process.env.E2E_TEST_EMAIL;
  const password = opts.password ?? process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'signIn() called without credentials. ' +
        'Set E2E_TEST_EMAIL/E2E_TEST_PASSWORD or pass opts.email/opts.password. ' +
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

/**
 * Clear the page's auth state (cookies + localStorage) so the next navigation
 * lands on the sign-in form. Used by multi-role specs that need to switch
 * identities between phases.
 */
export async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      // ignore — some test envs deny storage access
    }
  });
  await page.goto('/');
  await expect(page.locator('input#email')).toBeVisible({ timeout: 15_000 });
}
