import { expect, test } from '@playwright/test';

/**
 * Smoke tests that don't need credentials.
 *
 * These verify:
 *  - the Vite build actually serves HTML on `/`
 *  - the app's JS bundle mounts and renders something user-visible
 *  - no uncaught JS errors fire during initial mount
 *  - the PWA manifest is reachable
 *  - the sign-in form eventually renders for unauthenticated visitors
 *
 * This is scope "A" from the e2e plan — it validates that the CI job
 * can spin the app up end-to-end even without auth. It is the foundation
 * the auth-gated tests (scope "B") build on top of.
 */

test.describe('smoke: app boots', () => {
  test('root route returns HTML and mounts React', async ({ page }) => {
    // Collect uncaught exceptions so we can fail the test on any.
    const uncaught: Error[] = [];
    page.on('pageerror', (err) => uncaught.push(err));

    const response = await page.goto('/');
    expect(response, 'GET / should return a response').not.toBeNull();
    expect(response!.status(), 'GET / should be 200').toBe(200);

    // Wait for the React mount — the SPA shell replaces the <div id="root">
    // placeholder. We just need *something* rendered inside #root.
    await expect(page.locator('#root')).not.toBeEmpty();

    expect(uncaught, `uncaught errors during mount: ${uncaught.map((e) => e.message).join('\n')}`).toEqual([]);
  });

  test('PWA manifest is reachable', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status(), 'manifest.webmanifest should be served').toBe(200);
    const json = await res.json();
    expect(json, 'manifest should have a name field').toHaveProperty('name');
  });

  test('unauthenticated visit eventually exposes a sign-in form', async ({ page }) => {
    // RequireAuth redirects protected routes to `/`, which renders the
    // sign-in surface for unauthenticated visitors. We navigate to a
    // protected route so the redirect fires; then expect the sign-in
    // form to render.
    await page.goto('/dashboard');

    // The sign-in form in src/components/Auth.tsx has stable `id="email"`
    // and `id="password"` inputs and a "Sign In" submit button. Give it
    // time because the auth state machine has a "checking" step that
    // renders nothing briefly before committing to "redirect".
    await expect(page.locator('input#email')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input#password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('unknown route renders the 404 page', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    // The NotFound page renders user-visible text; we don't hard-code
    // the exact copy to stay resilient to wording changes. Just check
    // that the app did not crash (React mounted something).
    await expect(page.locator('#root')).not.toBeEmpty();
  });
});
