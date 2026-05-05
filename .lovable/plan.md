
## Diagnosis

The screenshot is **not** an in-app screen. It is the browser's native "no network" error page (Chrome shows the Rope Works app icon because it's an installed PWA, then renders its own "You're offline" string and the surf-game icons). React never mounts — meaning the **service worker never intercepted the navigation request**.

The previous round added a guest-mode path inside `Index.tsx`, but that only helps once the React bundle has loaded. If the SW isn't serving the app shell when offline, no in-app code runs at all.

Three concrete root causes in the current setup:

1. **App shell never reaches the user offline.** `vite-pwa-config.ts` sets `navigateFallback: '/'` and precaches JS/CSS/HTML, but in practice users hit `/` while installed and the precached document for `/` isn't always populated for them — particularly on iOS/Android installed PWAs whose first launch happened before VitePWA was wired this way (the old self-destroying SW history). Result: navigation falls through to the browser's offline page.
2. **Index-page boot does an `await supabase.auth.getSession()` even before the offline branch resolves.** When `navigator.onLine` is true but the request hangs (captive portal / airplane-mode race), the 5 s timeout is reached but the screen sits on "Loading…". Combined with #1, many users never see anything.
3. **No public, no-auth route exists.** Every meaningful URL is wrapped in `RequireAuth`. If a user lands offline with no cached session, no captured `offline_auth` entry, and no guest session, the only option is the sign-in screen — and that screen is gated by the React bundle loading first.

## Fix

### 1. Guarantee the app shell is served offline

In `vite-pwa-config.ts`:
- Switch the workbox config so the `index.html` document itself is precached and served as the navigation fallback for **every** route, including `/`. Add `cleanupOutdatedCaches: true` and `navigationPreload: true`.
- Add an explicit **`offline.html`** in `public/` (Rope Works logo + "Open the app" button that links to `/`). Add it to `includeAssets` and configure a Workbox `runtimeCaching` rule + `navigateFallback: '/offline.html'` denylist exception so that *if* the precached shell is missing for any reason, we still serve our branded page instead of Chrome's.
- Set `clientsClaim: true` and `skipWaiting: true` in workbox so a freshly-installed SW takes over the page immediately on first install (currently the user has to navigate twice before the SW controls them).

### 2. Make `Index.tsx` resilient on cold offline boot

In `src/pages/Index.tsx`:
- Reorder the offline branch to the **very top** of `checkAuth`, before any `supabase.auth.getSession()` race. Currently the offline branch already runs first when `!navigator.onLine`, but the timeout-Promise still fires for online-but-no-network devices (iOS reports `onLine === true` on planes/captive portals). Add a hard short-circuit: if the 5 s race rejects AND `localStorage` has no Supabase session, fall through to the same offline-recovery chain (cached → synthetic → captured → guest).
- Render the `Auth` screen unconditionally if every fallback is empty, so the user always reaches a usable surface.

### 3. Surface a one-tap offline entry on the splash

In `src/components/Auth.tsx`:
- The "Continue offline as Guest" button already exists, but it's hidden behind the form. Promote it to render at the top of the card whenever `!isOnline` (and even when `isOnline` is true but the user clicks a new "Use app offline" link), with prominent styling, so a user who lands offline can get into the dashboard with zero friction.
- Add a small "Open offline" link from the `offline.html` fallback that deep-links to `/?guest=1`; `Index.tsx` honours that query param by auto-creating a guest session and redirecting to `/dashboard`.

### 4. Sanity checks

- Verify `RequireAuth` keeps accepting `readGuestSession()` while offline (already does).
- Verify SW registration is allowed on production hostnames (it is — `isPreviewOrIframeEnvironment` only strips it inside the Lovable editor).
- Bump the PWA cache version so existing installs pick up the new `offline.html` and the precache change on next launch.

## Files to edit

- `vite-pwa-config.ts` — workbox precache + skipWaiting/clientsClaim + offline.html fallback
- `public/offline.html` (new) — branded fallback page
- `src/pages/Index.tsx` — hardened offline boot + `?guest=1` handling
- `src/components/Auth.tsx` — promote guest-mode button when offline
- `.lovable/memory/auth/offline-access-and-guest-mode.md` — note the new shell-precache + offline.html behaviour

## What the user will see after the fix

When offline, opening the installed app (or the URL in any browser):
1. SW serves the cached app shell → React mounts.
2. `Index.tsx` finds no session, finds no captured offline-auth, finds no guest session → renders `Auth` with a prominent "Continue offline as Guest" button at the top.
3. Tapping it creates a local guest session and routes to `/dashboard`. All inspection/training/photo features work; sync is silently disabled until reconnect.

If, in some catastrophic case, the SW shell isn't available (first-ever launch with no network), the `offline.html` Rope Works fallback shows with a "Try again" button instead of Chrome's generic page.
