---
name: offline-access-and-guest-mode
description: Offline shell delivery (precached index.html + offline.html fallback), three offline entry paths, ?guest=1 deep-link, sync guards rejecting guest ids
type: feature
---

**App shell offline delivery** is owned by `vite-pwa-config.ts`:
- Workbox precaches `index.html` and serves it as `navigateFallback` for every in-app route, with `clientsClaim: true` + `skipWaiting: true` so a fresh install controls its tab on first navigation.
- `public/offline.html` is a branded last-resort fallback (Rope Works logo + "Open the app" + "Continue as Guest" links). It exists so that if the precached shell is somehow missing, users see Rope Works branding instead of Chrome's native "You're offline" surf-game page. It is included via `includeAssets`.
- `?guest=1` query param on `/` is honoured by `src/pages/Index.tsx` even when online — the offline.html "Continue as Guest" link uses it to drop straight into a local-only guest session.

**Offline boot order** in `src/pages/Index.tsx` (`checkAuth`):
1. `?guest=1` shortcut → create guest session, go to dashboard
2. If `!navigator.onLine`: real cached Supabase session → synthetic offline session → single captured `offline_auth` IDB entry (auto-rebuilds synthetic via `createOfflineSession(email, '')`) → guest session → render Auth screen
3. Online with hung auth request: same offline-recovery chain runs in the catch block (covers captive portals / iOS reporting `onLine === true` on planes)

`src/components/Auth.tsx` always renders "Continue offline as Guest" as the **primary** action when offline (above the cached-reports button), so users with no captured credentials can still get in with one tap.

**Guest data MUST NOT sync.** Two boundary guards reject `id.startsWith('guest-')`:
- `assertRealSessionForSync` in `src/lib/atomic-sync-manager.ts`
- `safeFunctionsInvoke` in `src/lib/safe-functions-invoke.ts` (returns `GuestSessionForbidden`)

`getCachedUserFromStorage`, `getOfflineUserId`, `hasCachedSessionForOffline` in `src/lib/cached-auth.ts` fall through to `readGuestSession()` when offline. `RequireAuth` accepts guest as authenticated only while offline.

**Why:** Users opening the installed PWA offline were hitting Chrome's native offline page because the SW wasn't reliably serving the app shell. Even users who reached the React app could be dead-ended on the sign-in screen if their session-storage was cleared and they had no captured `offline_auth`. The shell-precache + offline.html fallback + promoted guest-mode button + `?guest=1` deep-link give every user a usable path.
