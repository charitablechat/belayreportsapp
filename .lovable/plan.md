## What I found

The app’s normal offline-in-an-open-tab path is mostly fine. The failure is the cold-start path after the installed PWA is fully closed and relaunched offline.

The current service worker can fall back to `public/offline.html`, which is exactly the black screen that says “You’re offline.” That page is a dead end because it only links to `/` and `/?guest=1`; when the app is still offline and the service worker keeps serving the fallback page, those links can loop back to the same fallback instead of booting React.

The riskiest pieces are:

- `public/sw-offline-navigation.js` treats `/offline.html` as a valid fallback for navigation requests.
- `public/offline.html` is a standalone page, not the app shell, so it cannot restore cached auth, guest mode, dashboard routes, IndexedDB reports, or the offline React UI.
- `vite-pwa-config.ts` disables Workbox’s navigation fallback with `navigateFallbackDenylist: [/./]`, leaving custom navigation handling as the only cold-start safety net.
- There is no e2e test that proves “install/open once → close → go offline → relaunch `/` or `/dashboard` → React app mounts instead of offline.html.” Existing tests explicitly treat offline lazy-chunk failures as a known PWA concern.

## Goal

Make offline cold launch deterministic: if the service worker has ever installed successfully, offline navigation must serve the React app shell, not the static “You’re offline” page. The fallback page can remain only as a last-resort recovery screen for devices that truly do not have the app shell cached.

## Implementation plan

1. **Change navigation fallback priority**
   - Update `public/sw-offline-navigation.js` so navigation requests prefer cached app shell entries only:
     - exact route cache match
     - `/index.html`
     - `/`
   - Do not serve `/offline.html` as a normal navigation fallback.
   - Only serve `/offline.html` for a true “no shell exists anywhere” last resort.

2. **Guarantee the app shell is cached under stable keys**
   - In the service worker install/activate path, cache `/` and `/index.html` from the network when possible.
   - When any HTML navigation succeeds online, write the same response to both `/` and `/index.html`.
   - Use same-origin credentials and tolerate failures so updates never brick the worker.

3. **Make `offline.html` self-healing instead of trapping**
   - Update `public/offline.html` so “Open the app” and “Continue as Guest” force navigation to the app shell route with a query marker instead of repeatedly landing on the fallback.
   - Add a small script that tries to locate `/index.html` or `/` in Cache Storage and redirects into the shell if found.
   - Keep the visible buttons as emergency options only.

4. **Let Workbox backstop SPA navigations again**
   - Adjust `vite-pwa-config.ts` so Workbox’s generated navigation fallback is not globally denied for every route.
   - Deny only routes that should never be handled as app navigations (`/~oauth`, `/version.json`, API-like paths), while allowing SPA routes such as `/`, `/dashboard`, `/inspection/:id`, `/training/:id`, and `/daily-assessment/:id` to fall back to `/index.html`.
   - Keep the custom navigation script as the first-line network-first handler.

5. **Add cold-start regression coverage**
   - Add an e2e smoke spec that:
     - loads the production preview server once to install the service worker,
     - verifies `/manifest.webmanifest` and `/sw.js` are reachable,
     - forces the browser offline,
     - navigates directly to `/` and `/dashboard`,
     - asserts that the React root mounts and the page is not `offline.html` / “You’re offline.”
   - This locks the exact failure mode so future PWA changes cannot reintroduce it silently.

6. **Verify the deployed-worker shape locally**
   - Run the targeted PWA/offline smoke test after implementation.
   - Inspect the generated `sw.js` text to confirm:
     - `sw-offline-navigation.js` is imported,
     - `index.html` is precached,
     - Workbox navigation fallback is not denied for every route,
     - `offline.html` is not the primary navigation fallback.

## Expected result

After this fix, closing the installed app, staying offline, and reopening it should load the React app shell every time the device has previously installed the service worker. From there, existing offline auth/guest/dashboard logic can run normally instead of being bypassed by the static black fallback page.

## Important note

Devices already stuck on an older service worker may need one successful online launch after this release so the corrected worker can install. After that, offline cold starts should no longer fall into the “You’re offline” trap.