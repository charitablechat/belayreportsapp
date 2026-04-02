

# Audit: Remaining Gaps in Admin Privilege Loss / Session Termination

## Findings

After a thorough review of the codebase, the previous P0-P3 fixes addressed the most critical vectors. However, **five additional gaps** remain.

---

### Gap 1: `useRequireAdmin` has no resilience to transient failures
**File:** `src/hooks/useRequireAdmin.tsx`

The `catch` block (line 44-48) unconditionally sets `isAdmin(false)` and redirects to `/dashboard` on any error — including network timeouts, LockManager contention, or transient RPC failures. Unlike Dashboard and Header, it has no fallback to `localStorage` cached admin status.

**Fix:** Before redirecting on error, check `localStorage.getItem('cached-admin-status')`. Only redirect if the cached value is also not `'true'`. This makes the SuperAdminDashboard and Onboarding pages survive transient failures.

---

### Gap 2: `useRequireAdmin` redirects when `getUserWithCache()` returns null transiently
**File:** `src/hooks/useRequireAdmin.tsx` (line 23-25)

If `getUserWithCache()` returns `null` due to a timeout or LockManager error (not a real sign-out), the hook immediately redirects to `/`. It does not attempt `getOfflineUserId()` as a fallback, unlike the report forms.

**Fix:** Add an `getOfflineUserId()` fallback before redirecting. Only redirect if both return null AND `navigator.onLine` is true.

---

### Gap 3: `useRequireAdmin` makes a redundant `is_super_admin` RPC call
**File:** `src/hooks/useRequireAdmin.tsx` (line 37)

After confirming admin access via `is_admin_or_above`, it makes a second RPC call to `is_super_admin`. Both functions now check for the same `admin` role (per the unification documented in memory). This is a wasted network call that adds latency and another failure point. If this second call fails, `isSuperAdmin` stays `false`, which could hide admin-only UI controls.

**Fix:** Remove the second RPC call. Set `isSuperAdmin = hasAccess` directly, since `is_super_admin` and `is_admin_or_above` are functionally identical after the role unification.

---

### Gap 4: `getSuperAdminStatusWithCache()` in `cached-auth.ts` still calls `is_super_admin` RPC
**File:** `src/lib/cached-auth.ts` (line 256)

This function is used by `useReportEditPermission` and the Dashboard report loaders. It calls `is_super_admin` — which is correct (same result as `is_admin_or_above`). However, it writes results to `cached-admin-status` in localStorage, while consuming components also read `cached-super-admin-status`. The dual-key pattern creates a subtle inconsistency: if one key is stale and the other is fresh, the fallback value depends on which component reads first.

**Fix:** Consolidate to a single localStorage key (`cached-admin-status`). Remove all reads/writes of `cached-super-admin-status` across the codebase. The backward-compat aliases in `cached-auth.ts` can stay as code aliases but should write to one key only.

---

### Gap 5: `Profile.tsx` redirects to `/` on transient auth failure
**File:** `src/pages/Profile.tsx` (line 56-58)

If `getUserWithCache()` returns null (network timeout, LockManager), the Profile page redirects to the login screen. No offline fallback, no cached session check.

**Fix:** Add the same `getOfflineUserId()` fallback pattern used in report forms. Only redirect if genuinely unauthenticated (online + no cached session).

---

## Implementation Summary

| # | Gap | File | Fix |
|---|-----|------|-----|
| 1 | `useRequireAdmin` catch redirects on transient errors | `src/hooks/useRequireAdmin.tsx` | Fallback to `cached-admin-status` before redirect |
| 2 | `useRequireAdmin` redirects on null user without offline fallback | `src/hooks/useRequireAdmin.tsx` | Add `getOfflineUserId()` + online guard |
| 3 | Redundant `is_super_admin` RPC in `useRequireAdmin` | `src/hooks/useRequireAdmin.tsx` | Remove second call; `isSuperAdmin = hasAccess` |
| 4 | Dual localStorage keys for admin cache | `src/lib/cached-auth.ts`, `src/components/AuthenticatedHeader.tsx`, `src/pages/Dashboard.tsx` | Consolidate to single `cached-admin-status` key |
| 5 | `Profile.tsx` redirects on transient null user | `src/pages/Profile.tsx` | Add offline fallback before redirect |

All fixes are backward-compatible, require no database migration, and follow the resilience patterns already established in Dashboard and report forms.

