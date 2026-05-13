---
name: offline-cold-start-contract
description: Offline cold-start of the installed PWA must serve the React app shell, never offline.html as primary navigation fallback
type: constraint
---

When the installed PWA is fully closed and relaunched OFFLINE, navigation
requests for SPA routes (`/`, `/dashboard`, `/inspection/:id`, etc.) MUST
resolve to the React app shell (cached `/index.html` or `/`). They MUST
NOT resolve to the static `public/offline.html` page.

The static offline.html page is a last-resort recovery surface only.
Returning it as the primary navigation fallback traps users on a black
"You're offline" screen they cannot escape because the React app never
mounts (no offline auth, no guest session, no IndexedDB reports, no
dashboard).

**How this is enforced today:**
- `public/sw-offline-navigation.js` runs first via `importScripts`. Its
  fetch handler is network-first; the offline catch path looks for the
  shell in EVERY cache (own + Workbox precache + runtime) before
  considering offline.html. `lastResortShell()` is only reached when no
  shell exists in any cache.
- `vite-pwa-config.ts` keeps Workbox's `navigateFallback: '/index.html'`
  enabled with a narrow `navigateFallbackDenylist` (only `/~oauth`,
  `/api/`, `/version.json`). Workbox is the second-line backstop for any
  navigation that escapes the custom handler.
- `public/offline.html` self-heals on load: it scans Cache Storage for
  `/index.html` or `/` and `location.replace('/?shell=1')` if found, so
  even a stale device that lands here once gets bounced back into the
  app shell.
- `tests/e2e/smoke/offline-cold-start.spec.ts` locks this behaviour: it
  installs the SW online, goes offline, reloads `/` and `/dashboard`,
  and asserts the page is NOT offline.html (title check + "Opening Rope
  Works…" absence + non-empty `#root`).

**Do not regress:**
- Do not add `/offline.html` back into the primary candidate list in
  `findShellResponse` (sw-offline-navigation.js).
- Do not set `navigateFallbackDenylist: [/./]` in vite-pwa-config.ts —
  that disables Workbox's navigation backstop entirely and was the
  original cold-start trap.
- Do not change offline.html into a static dead-end again — it must
  always self-heal back to the shell.
