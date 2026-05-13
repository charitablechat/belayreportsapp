import { expect, test } from '@playwright/test';

/**
 * Offline cold-start regression test.
 *
 * Locks the bug where the installed PWA, when fully closed and relaunched
 * offline, would land on the static "You're offline" fallback page
 * (public/offline.html) and trap the user. After the fix:
 *  - the service worker installs on the first online visit,
 *  - going offline + reloading any SPA route (`/`, `/dashboard`) must serve
 *    the React app shell, NOT the static offline.html.
 *
 * Implementation notes:
 *  - We assert the page is not the offline.html document by checking the
 *    `<title>` ("Rope Works - Digital Inspection Platform") and the React
 *    root mounting non-empty content. The offline.html title is just
 *    "Rope Works".
 *  - The "Opening Rope Works…" copy is also unique to offline.html — its
 *    absence is a second guard.
 */
test.describe('offline cold-start: PWA must never trap users on offline.html', () => {
  test('relaunching `/` offline serves the React app shell', async ({ page, context }) => {
    // 1. Online visit so the SW installs and precaches the shell.
    await page.goto('/');
    await page.waitForLoadState('load');
    await page.waitForFunction(
      () => navigator.serviceWorker?.controller != null
        || (navigator.serviceWorker && navigator.serviceWorker.ready != null),
      { timeout: 15_000 },
    ).catch(() => { /* tolerated — fallback assertions below still apply */ });
    // Give the SW a beat to finish precaching.
    await page.waitForTimeout(1500);

    // 2. Drop the network and cold-reload `/`.
    await context.setOffline(true);
    await page.goto('/', { waitUntil: 'load' });

    // 3. Must be the real app shell, not the offline fallback.
    const title = await page.title();
    expect(title, `offline reload should serve app shell, got title=${title}`)
      .not.toBe('Rope Works');
    await expect(page.locator('text=Opening Rope Works…')).toHaveCount(0);
    await expect(page.locator('#root')).not.toBeEmpty();
  });

  test('relaunching `/dashboard` offline serves the React app shell', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);

    await context.setOffline(true);
    await page.goto('/dashboard', { waitUntil: 'load' });

    await expect(page.locator('text=Opening Rope Works…')).toHaveCount(0);
    await expect(page.locator('#root')).not.toBeEmpty();
  });
});
