

# Security Investigation: Admin Privilege Loss / Unexpected Session Termination

## Executive Summary

After auditing the session management, RBAC, and auth state handling code, I identified **five concrete vulnerability vectors** that can cause an admin to lose privileges or get signed out unexpectedly. Several are race conditions in the existing architecture; one is a cache-poisoning risk.

---

## 1. Session Management Vulnerabilities

### 1a. Token Expiry Race with 60-Second Refresh Buffer
**File:** `src/lib/cached-auth.ts` (line 22, 434-436)

The session refresh buffer is only 60 seconds. If a user's tab is backgrounded (mobile Safari aggressively freezes tabs), the JWT can expire without triggering the pre-emptive refresh. When the tab resumes:
- `getCachedUserFromStorage()` returns `null` because `expiresAt * 1000 <= Date.now()` (line 307)
- `getUserWithCache()` falls through to the network path
- If the network call fails or the refresh token is also expired, the user appears unauthenticated

**Impact:** Admin is redirected to `/` by `useRequireAdmin` (line 23-25) or to `/dashboard` by the catch block (line 48).

### 1b. LockManager Contention (Supabase auth-js)
**File:** `src/lib/cached-auth.ts` (lines 29-32, 389-400)

Multiple concurrent auth operations (background sync, pre-emptive refresh, visibility-change queries) compete for the browser's `LockManager`. If the lock times out, the fallback reads from localStorage—but if the token just expired, localStorage returns `null`, and the user is treated as unauthenticated.

### 1c. `SIGNED_OUT` Event While Offline Is Guarded—But Not Everywhere
**Files:** `Dashboard.tsx` (line 334), `AuthenticatedHeader.tsx` (line 46)

Both guard `SIGNED_OUT` with `navigator.onLine`. However, `cached-auth.ts` (line 43) does **not** check `navigator.onLine` before calling `invalidateUserCache()`. If the Supabase client emits a `SIGNED_OUT` event during a transient network glitch, the in-memory cache is destroyed, and subsequent `getUserWithCache()` calls will fail until a successful network fetch.

---

## 2. RBAC Synchronization Issues

### 2a. Admin Status Cache Poisoning via Transient Auth Failure
**Files:** `AuthenticatedHeader.tsx` (lines 79-82), `Dashboard.tsx` (lines 191-194)

Both admin-check queries set `cached-super-admin-status` to `"false"` in localStorage when `getUserWithCache()` returns `null`—even if the null is caused by a transient network timeout rather than an actual sign-out. Once written, this poisoned value persists and is used as the `placeholderData` for future renders, meaning:

1. Network blip → `getUserWithCache()` returns null
2. `localStorage.setItem("cached-super-admin-status", "false")` is written
3. User regains connectivity, but the query's `placeholderData` returns `false`
4. UI hides admin controls; `useRequireAdmin` redirects to `/dashboard`

This is the **most likely root cause** for "lost admin privileges while session remained active."

### 2b. Dual-Path Admin Check Inconsistency
- `useRequireAdmin` uses `supabase.rpc("is_admin_or_above")` — a SECURITY DEFINER function checking `user_roles` for `admin` or `super_admin`.
- `AuthenticatedHeader` and `Dashboard` query `user_roles` table directly via the client SDK with `.eq("role", "admin")`.

If the RLS policy on `user_roles` is restrictive (e.g., users can only see their own roles), the direct query path works. But if there's any RLS evaluation failure (e.g., during token refresh), the direct query silently returns an empty array, which the code interprets as "not admin."

---

## 3. Client-Side / Browser Interference

### 3a. localStorage Clearing
iOS Safari can evict localStorage under memory pressure (especially in PWA/WebView contexts). If `sb-...-auth-token` is cleared:
- All auth checks fail
- Admin status cache keys are lost
- User appears unauthenticated

### 3b. Multiple Tabs / Service Worker Token Forwarding
The service worker receives `AUTH_TOKEN` messages on every auth event (line 47-52 of `cached-auth.ts`). If two tabs are open and one signs out, the `SIGNED_OUT` event propagates to the `cached-auth` listener in the other tab, invalidating its cache.

---

## 4. Audit Log Analysis Strategy

### What to Query
The database has an `audit_logs` table and `audit_user_role_changes` trigger. To pinpoint the incident:

```sql
-- Check if admin role was removed or modified
SELECT * FROM audit_logs
WHERE action_type IN ('role_removed', 'role_changed')
  AND (old_values->>'role' = 'admin' OR new_values->>'role' = 'admin')
ORDER BY created_at DESC
LIMIT 20;

-- Verify the user still has the admin role right now
SELECT * FROM user_roles
WHERE user_id = '<admin-user-id>';

-- Check auth logs for forced sign-outs or token refresh failures
-- (Available via Lovable Cloud auth logs, not queryable via SQL)
```

### Interpretation
- If the `user_roles` row is intact and no `role_removed` audit entry exists → the issue is **client-side cache poisoning** (vector 2a above), not a real privilege revocation.
- If the role was removed → check `audit_logs.metadata->>'affected_user_id'` to identify who performed the action.

---

## 5. Recommended Fixes (Implementation Ready)

| Priority | Fix | Files |
|----------|-----|-------|
| **P0** | Stop writing `"false"` to admin cache on transient auth failures. Only write `"false"` when online AND a valid user is confirmed AND the role query succeeds with no error. | `AuthenticatedHeader.tsx`, `Dashboard.tsx` |
| **P1** | Guard `invalidateUserCache()` in `cached-auth.ts` against offline `SIGNED_OUT` events, matching the pattern already used in Dashboard/Header. | `cached-auth.ts` |
| **P2** | Increase `SESSION_REFRESH_BUFFER` from 60s to 300s to match the pre-emptive refresh window already used elsewhere. | `cached-auth.ts` |
| **P3** | Unify admin checks: replace direct `user_roles` table queries in Header/Dashboard with `supabase.rpc("is_admin_or_above")` to match `useRequireAdmin`. | `AuthenticatedHeader.tsx`, `Dashboard.tsx` |

Shall I implement these fixes?

