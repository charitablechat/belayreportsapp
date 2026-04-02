

# Security Audit: Admin Privilege Loss & Unexpected Session Termination

## Status of Previous Fixes

The P0-P3 fixes and Gap 1-5 fixes have been successfully applied. The `cached-super-admin-status` key is fully eliminated. `useRequireAdmin`, `AuthenticatedHeader`, `Dashboard`, and `Profile` all have proper offline/transient-failure resilience. This audit focuses on **remaining gaps** not yet addressed.

---

## Remaining Vulnerabilities Found

### V1: `getAdminStatusWithCache()` calls `is_super_admin` instead of `is_admin_or_above` (Inconsistency)

**File:** `src/lib/cached-auth.ts`, line 256
**Severity:** Low (functionally equivalent today, but a maintenance hazard)

While `useRequireAdmin`, `Dashboard`, and `AuthenticatedHeader` all call `is_admin_or_above`, the shared `getAdminStatusWithCache()` function still calls `is_super_admin`. Both RPCs currently return the same result, but if they ever diverge, every consumer of `getSuperAdminStatusWithCache()` (used by `useReportEditPermission`, `Dashboard.refreshReports`) would silently produce different results than the UI admin checks.

**Fix:** Change line 256 from `supabase.rpc('is_super_admin')` to `supabase.rpc('is_admin_or_above')` for consistency.

---

### V2: `useReportEditPermission` clears `isSuperAdmin` on transient offline sign-out

**File:** `src/hooks/useReportEditPermission.tsx`, lines 92-94

When `onAuthStateChange` fires with a null session while online, `isSuperAdmin` is set to `false`. However, it does NOT fall back to `cached-admin-status` in localStorage. If the event fires due to a transient token refresh failure that briefly reports `navigator.onLine === true`, an admin editing another user's report would lose edit capability mid-session.

**Impact:** Medium — admin loses edit access on someone else's report during a network flicker. The report becomes read-only until the next successful auth check.

**Fix:** In the `else if (navigator.onLine)` branch (line 92), read `localStorage.getItem('cached-admin-status')` before setting `isSuperAdmin(false)`. Only clear if the cache also confirms non-admin.

---

### V3: `cached-auth.ts` auth listener is not cleaned up (minor leak)

**File:** `src/lib/cached-auth.ts`, line 42

The `onAuthStateChange` listener in `initAuthListener()` is registered once and never unsubscribed. This is intentional (singleton pattern), but if the Supabase client is ever re-initialized (e.g., during testing or hot reload in dev), the old listener remains attached, potentially calling `invalidateUserCache()` on stale events.

**Impact:** Low — only affects dev/test environments. In production the client is never re-created.

**Recommendation:** No code change needed, but document this as an intentional design choice.

---

### V4: Multiple `onAuthStateChange` subscriptions across components

**Files:** `AuthenticatedHeader.tsx`, `Dashboard.tsx`, `InspectionForm.tsx`, `useReportEditPermission.tsx`, `cached-auth.ts`

Five separate `onAuthStateChange` listeners are active simultaneously. Each handles the `SIGNED_OUT` event independently. While they all have the `navigator.onLine` guard, there's a subtle race: if one listener fires `navigate("/")` before another has finished processing, React state updates can interleave unpredictably.

**Impact:** Low — the guards are consistent, and React batches state updates. The main risk is redundant processing, not privilege loss. No code change recommended.

---

### V5: `InspectionForm.tsx` auth listener clears user without offline fallback

**File:** `src/pages/InspectionForm.tsx`, lines 467-471

```typescript
} else if (navigator.onLine) {
  setCurrentUser(null);
}
```

When the auth state fires with a null session while online, `currentUser` is set to null. This doesn't redirect, but it could disable UI elements that depend on `currentUser` (save buttons, photo capture). The report forms already have an initial offline fallback for `fetchUser`, but the auth listener does not attempt `getOfflineUserId()` before clearing.

**Impact:** Low — the form data is preserved in IndexedDB, and the user can refresh to recover. The `useReportEditPermission` hook independently maintains its own `currentUserId` with the offline guard, so edit permissions are not affected.

**Recommendation:** Consider consistency but not a security vulnerability.

---

## Summary Table

| # | Gap | Severity | File | Action |
|---|-----|----------|------|--------|
| V1 | `getAdminStatusWithCache` uses wrong RPC | Low | `cached-auth.ts:256` | Change to `is_admin_or_above` |
| V2 | `useReportEditPermission` clears admin on transient failure | Medium | `useReportEditPermission.tsx:92` | Add localStorage fallback |
| V3 | Auth listener never unsubscribed | Low | `cached-auth.ts:42` | Document only |
| V4 | Multiple auth listeners race | Low | Multiple files | No change needed |
| V5 | InspectionForm clears user on transient auth | Low | `InspectionForm.tsx:467` | Optional consistency fix |

## Recommended Implementation

Only V1 and V2 warrant code changes:

1. **`src/lib/cached-auth.ts` line 256** — Replace `supabase.rpc('is_super_admin')` with `supabase.rpc('is_admin_or_above')` to unify all admin checks on the same RPC.

2. **`src/hooks/useReportEditPermission.tsx` lines 92-94** — Before setting `isSuperAdmin(false)`, check `localStorage.getItem('cached-admin-status') === 'true'` as a fallback, matching the resilience pattern used everywhere else.

No database migrations needed. Both fixes are backward-compatible.

