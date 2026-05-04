---
name: offline-access-and-guest-mode
description: Three offline entry paths (cached session, captured refresh token auto-resume, guest mode) + sync guards rejecting guest ids
type: feature
---

Offline boot in `src/pages/Index.tsx` tries entries in order: real Supabase session → synthetic offline session → single captured `offline_auth` IDB entry (auto-rebuilds synthetic via `createOfflineSession(email, '')`) → guest session. Multiple captured entries leave user on Auth screen for manual pick (shared-device safety).

`src/components/Auth.tsx` always renders "Continue offline as Guest" button when offline. `createGuestSession()` in `src/lib/guest-session.ts` writes `{ id: 'guest-<uuid>', isGuest: true }` to localStorage `guest_session` key.

Guest data MUST NOT sync. Two boundary guards reject `id.startsWith('guest-')`:
- `assertRealSessionForSync` in `src/lib/atomic-sync-manager.ts`
- `safeFunctionsInvoke` in `src/lib/safe-functions-invoke.ts` (returns `GuestSessionForbidden`)

`getCachedUserFromStorage`, `getOfflineUserId`, `hasCachedSessionForOffline` in `src/lib/cached-auth.ts` fall through to `readGuestSession()` when offline. `RequireAuth` (`src/components/auth/RequireAuth.tsx`) accepts guest as authenticated only while offline.

**Why:** Users with cleared session storage but valid IDB credentials were dead-ended on the offline sign-in screen. Users who never signed in on the device had no path at all.
