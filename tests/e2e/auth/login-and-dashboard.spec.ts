import { expect, test } from '@playwright/test';
import { signIn } from '../_fixtures/auth';

/**
 * Scope "B" — auth-gated golden path.
 *
 * Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD env vars to be set.
 * When either is missing the whole describe block is skipped so CI
 * can run the smoke suite on PRs without forcing every contributor
 * to own a test account.
 *
 * These tests use a REAL Supabase login against whatever project
 * VITE_SUPABASE_URL points at. They deliberately stop before any
 * action that would persist data to Supabase — getting to the
 * "New Inspection Report" form is enough to prove the auth-gated
 * routing works end-to-end. A future spec can extend this to
 * actually save a draft once we have a cleanup story.
 */

const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;

test.describe('auth: signed-in golden path', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Skipping auth-gated e2e: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run.'
  );

  test('login → dashboard → new-inspection form → reload stays authenticated', async ({
    page,
  }) => {
    // Collect uncaught exceptions so we can fail on any.
    const uncaught: Error[] = [];
    page.on('pageerror', (err) => uncaught.push(err));

    // 1–3. Sign in via the shared fixture. Resolves once /dashboard loads.
    await signIn(page);
    await expect(page.locator('#root')).not.toBeEmpty();

    // 4. From the dashboard, the "Inspection Report" card has a
    // "Start Inspection" button (also clickable as a card). Click it.
    await page
      .getByRole('button', { name: /start inspection/i })
      .first()
      .click();

    // 5. Verify the new-inspection form rendered. The CardTitle text
    // "New Inspection Report" is the most stable user-visible signal.
    await page.waitForURL(/\/inspection\/new/, { timeout: 10_000 });
    await expect(
      page.getByText(/new inspection report/i).first()
    ).toBeVisible();

    // 6. Reload directly on a protected route. Auth should persist —
    // we should land back on /inspection/new, NOT bounce to /.
    await page.reload();
    await expect(page).toHaveURL(/\/inspection\/new/);
    await expect(
      page.getByText(/new inspection report/i).first()
    ).toBeVisible({ timeout: 15_000 });

    // 7. No uncaught errors during the whole flow.
    expect(
      uncaught,
      `uncaught errors during signed-in flow: ${uncaught
        .map((e) => e.message)
        .join('\n')}`
    ).toEqual([]);
  });
});
