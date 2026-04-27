import { expect, test, type Page } from '@playwright/test';

/**
 * Tier-2 #5b — password-reset request flow (unauthenticated).
 *
 * Covers the front-end half of the forgot-password user journey:
 *   1. Sign-in form is reachable on `/`.
 *   2. Clicking "Forgot password?" switches the form to reset mode
 *      (description, button label, and field visibility all rotate).
 *   3. Submitting a valid email POSTs to Supabase's recover endpoint
 *      with the correct payload (email + redirectTo derived from
 *      `window.location.origin`).
 *   4. A success toast renders and the form auto-returns to sign-in mode
 *      (matches `setIsForgotPassword(false)` in `Auth.tsx`).
 *   5. The "Back to sign in" affordance also routes back to sign-in mode
 *      without auto-success.
 *
 * Why mock the network call instead of hitting Supabase for real:
 *   - `resetPasswordForEmail` is rate-limited (~3-4/hour per email by
 *     default). Real CI runs would either spam an inbox or trip the
 *     limit and false-fail.
 *   - The spec's job is to gate the FE flow + the request payload
 *     (redirectTo correctness was the entire point of PR #4 hardening
 *     `SITE_URL`). Verifying Supabase actually sends an email is the
 *     job of Tier-1 #4 (manual SITE_URL verification on real prod
 *     creds), not this gate.
 *
 * Lives in `tests/e2e/smoke/` (not `auth/`) because it requires no
 * credentials — runs unconditionally in CI.
 */

const RECOVER_URL = '**/auth/v1/recover*';

async function captureRecoverRequest(page: Page) {
  let captured: { url: string; body: unknown } | null = null;
  await page.route(RECOVER_URL, async (route) => {
    const request = route.request();
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData();
    }
    captured = { url: request.url(), body };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });
  return () => captured;
}

test.describe('auth: password-reset request flow', () => {
  test.setTimeout(60_000);

  test('forgot-password form switches mode, posts to recover, and returns to sign-in', async ({
    page,
  }) => {
    const uncaught: Error[] = [];
    page.on('pageerror', (err) => {
      // Lazy-chunk fetch failures during fresh CI cold-start aren't
      // expected here, but the existing scope-C/scope-cloud-backup specs
      // filter this class because it's a known PWA concern; mirror the
      // filter so a transient SW miss doesn't trip the assertion.
      if (/Failed to fetch dynamically imported module/i.test(err.message)) {
        return;
      }
      uncaught.push(err);
    });

    const getRecoverCall = await captureRecoverRequest(page);

    // ── 1. Sign-in form is reachable ─────────────────────────────────────
    await page.goto('/');
    await expect(page.locator('input#email')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input#password')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^sign in$/i })
    ).toBeVisible();

    // ── 2. Switch to forgot-password mode ────────────────────────────────
    await page.getByRole('button', { name: /forgot password\?/i }).click();

    // The header description rotates to "Reset your password", the
    // password input goes away, the submit button label becomes
    // "Send Reset Link", and a "Back to sign in" affordance appears.
    await expect(page.getByText(/^reset your password$/i)).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('input#password')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /send reset link/i })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /back to sign in/i })
    ).toBeVisible();

    // ── 3. Submit a valid email; recover endpoint should be hit ──────────
    const TEST_EMAIL = 'reset-flow-e2e@example.invalid';
    await page.locator('input#email').fill(TEST_EMAIL);
    await page.getByRole('button', { name: /send reset link/i }).click();

    // ── 4. Recover endpoint received the right payload ───────────────────
    await expect
      .poll(() => getRecoverCall(), { timeout: 10_000 })
      .not.toBeNull();
    const call = getRecoverCall();
    expect(call, 'recover request should have been captured').not.toBeNull();
    // `body` is the parsed JSON Supabase sent on POST /auth/v1/recover.
    // It always contains `email`; `redirectTo` flows in via the URL
    // query string, so we check both shapes for safety.
    const bodyRecord = (call!.body ?? {}) as Record<string, unknown>;
    expect(bodyRecord.email).toBe(TEST_EMAIL);
    const redirectFromBody =
      typeof bodyRecord.redirect_to === 'string'
        ? bodyRecord.redirect_to
        : typeof bodyRecord.redirectTo === 'string'
          ? bodyRecord.redirectTo
          : null;
    const redirectFromQuery = new URL(call!.url).searchParams.get('redirect_to');
    const effectiveRedirect = redirectFromBody ?? redirectFromQuery;
    expect(
      effectiveRedirect,
      'recover request should include a redirectTo derived from window.location.origin'
    ).toBeTruthy();
    // The redirectTo must point back at the app's own origin — the PR #4
    // SITE_URL fallback hardening exists precisely to keep this from
    // being `localhost` in production. We can't assert the prod host
    // here (the test runs against `127.0.0.1`), but we can assert the
    // shape: same-origin and not an empty string.
    expect(effectiveRedirect!.startsWith(new URL(page.url()).origin)).toBe(
      true
    );

    // ── 5. UI state after success: toast + auto-return to sign-in ────────
    // The Auth.tsx success branch fires a Sonner toast then calls
    // `setIsForgotPassword(false)` — wait for the toast (visible ~5s)
    // and for the password input to come back.
    await expect(
      page.getByText(/password reset email sent/i).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input#password')).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole('button', { name: /^sign in$/i })
    ).toBeVisible();

    // ── 6. Back-to-sign-in escape path ───────────────────────────────────
    // Switch back into forgot-password mode and use the explicit
    // "Back to sign in" button this time.
    await page.getByRole('button', { name: /forgot password\?/i }).click();
    await expect(
      page.getByRole('button', { name: /send reset link/i })
    ).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /back to sign in/i }).click();
    await expect(page.locator('input#password')).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByRole('button', { name: /^sign in$/i })
    ).toBeVisible();

    expect(
      uncaught,
      `uncaught page errors: ${uncaught.map((e) => e.message).join('; ')}`
    ).toEqual([]);
  });
});
