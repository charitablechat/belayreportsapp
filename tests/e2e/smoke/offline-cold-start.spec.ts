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
  // Wait for the SW to actually control the page AND finish precaching the
  // current build. Without this, going offline races the precache: the
  // navigation HTML is served from the SW shell but the hashed CSS/JS
  // chunks miss cache and React never mounts.
  //
  // The previous predicate `navigator.serviceWorker.ready != null` was a
  // no-op — `.ready` is a Promise (always truthy) — so the spec only
  // waited 1500ms before going offline and was already flaky pre-282002a.
  async function waitForSwControlled(page: import('@playwright/test').Page) {
    await page.waitForFunction(
      async () => {
        if (!('serviceWorker' in navigator)) return true;
        const reg = await navigator.serviceWorker.ready;
        return !!reg.active && !!navigator.serviceWorker.controller;
      },
      { timeout: 20_000 },
    ).catch(() => { /* tolerated — assertions below still apply */ });

    // Wait until every hashed asset referenced by the current document is
    // present in Cache Storage. Replaces the previous fixed 3s sleep, which
    // raced precache + asset warm-up on slower CI runners and produced the
    // empty-#root offline failure mode. Our SW warms these via the
    // `warm-assets` postMessage from main.tsx; Workbox also precaches them.
    await page.waitForFunction(
      async () => {
        try {
          const targets: string[] = [];
          document.querySelectorAll<HTMLScriptElement>('script[src]').forEach((el) => {
            if (el.src) targets.push(el.src);
          });
          document.querySelectorAll<HTMLLinkElement>(
            'link[rel="stylesheet"][href], link[rel="modulepreload"][href]'
          ).forEach((el) => {
            if (el.href) targets.push(el.href);
          });
          if (targets.length === 0) return true;
          for (const url of targets) {
            const hit = await caches.match(url, { ignoreSearch: true });
            if (!hit) return false;
          }
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 20_000 },
    ).catch(() => { /* tolerated — assertions below still apply */ });
  }

  test('relaunching `/` offline serves the React app shell', async ({ page, context }) => {
    // 1. Online visit so the SW installs, activates, and precaches the shell.
    await page.goto('/');
    await page.waitForLoadState('load');
    await waitForSwControlled(page);

    // 2. Drop the network and cold-reload `/`.
    await context.setOffline(true);
    await page.goto('/', { waitUntil: 'load' });

    // 3. Must be the real app shell, not the offline fallback.
    const title = await page.title();
    expect(title, `offline reload should serve app shell, got title=${title}`)
      .not.toBe('Rope Works');
    await expect(page.locator('text=Opening Rope Works…')).toHaveCount(0);
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });
  });

  test('relaunching `/dashboard` offline serves the React app shell', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForLoadState('load');
    await waitForSwControlled(page);

    await context.setOffline(true);
    await page.goto('/dashboard', { waitUntil: 'load' });

    await expect(page.locator('text=Opening Rope Works…')).toHaveCount(0);
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });
  });
});

