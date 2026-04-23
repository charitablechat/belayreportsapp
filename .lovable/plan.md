

## L8 — Per-user admin cache on shared device

Investigated. **The original concern (User B inheriting User A's admin role) is already resolved.** No code change needed.

### Why it's not exploitable today

1. **Cache keys are namespaced per user-id.** `getAdminCacheKey(userId)` returns `cached-admin-status:<userId>` (`src/lib/cached-auth.ts:38-40`). There is no longer a global `cached-admin-status` key — the legacy one is wiped on every boot (`:77-82`).

2. **`useRequireAdmin` reads the namespaced key for the *currently identified* user only.** The offline fallback path does `localStorage.getItem(getAdminCacheKey(getOfflineUserId()))`. `getOfflineUserId()` (`:590-604`) reads the user-id from the active Supabase session in localStorage (`sb-<ref>-auth-token`) or the synthetic offline session — *both of which belong to whoever last signed in on this device*. User B cannot read User A's `cached-admin-status:<userA>` entry because B's `getOfflineUserId()` returns B's id, which keys into `cached-admin-status:<userB>` (absent → falls through to `navigate("/dashboard")`).

3. **Sign-in invalidates other users' cache entries.** The `SIGNED_IN`/`USER_UPDATED` listener (`:162-190`) sweeps every `cached-admin-status:*` and `cached-true-super-admin:*` key that doesn't end in `:<newUserId>`, and resets in-memory caches.

4. **Sign-out wipes ALL admin cache entries.** `invalidateUserCache()` calls `clearAllAdminCacheKeys()` (`:355-369`), which removes every namespaced entry on the device.

### Residual edge case (acknowledged, not a regression)

If User A signs in **offline**, becomes admin-cached, then User B signs in **offline** *without User A having signed out first*, User A's `cached-admin-status:<userA>` entry survives because the offline sign-in path doesn't invoke the online `SIGNED_IN` listener that does the cross-user sweep. However, this is **harmless** — User B's `useRequireAdmin` only reads the key matching B's user-id. A's entry is dead data, evicted on next online sign-in.

### Recommendation

Close as resolved. Confirmed by reading `src/lib/cached-auth.ts` (lines 34-82, 162-190, 355-369, 414-419, 590-604) and `src/hooks/useRequireAdmin.tsx`. The earlier audit predates the C7 namespacing refactor.

