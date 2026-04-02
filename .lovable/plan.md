

# Comprehensive Security Audit: Final Gaps

## Summary

After thoroughly reviewing all session management, RBAC, auth listeners, edge functions, and client-side caching across the entire codebase, the previous fixes (P0-P3, Gaps 1-5, V1-V2) have closed the major vulnerability surface. Two remaining gaps warrant code changes.

---

## Remaining Gaps

### G1: Edge functions still call `is_super_admin` RPC instead of `is_admin_or_above`

**Files:**
- `supabase/functions/send-training-pdf-email/index.ts` (line 79)
- `supabase/functions/admin-manage-user/index.ts` (line 71)

Both edge functions call `supabase.rpc("is_super_admin")` for authorization. While `is_super_admin()` is currently aliased to check for the `admin` role (so it works today), this is inconsistent with the client-side unification to `is_admin_or_above`. If `is_super_admin()` is ever deprecated or its semantics change, these functions would silently break.

**Severity:** Low (functionally correct today, maintenance hazard)

**Fix:** Replace `supabase.rpc("is_super_admin")` with `supabase.rpc("is_admin_or_above")` in both edge functions.

---

### G2: `generate-inspection-pdf` edge function uses service role key to fetch data, bypassing RLS

**File:** `supabase/functions/generate-inspection-pdf/index.ts` (line 24-25)

The function authenticates the user via their JWT token (correct), but then creates a Supabase client using `SUPABASE_SERVICE_ROLE_KEY` to fetch inspection data. This means any authenticated user who knows an inspection ID could generate a PDF for any report, regardless of RLS policies. The function does not check ownership or admin status.

**Severity:** Medium — any authenticated user can generate PDFs for reports they shouldn't have access to.

**Fix:** Either:
- (a) Add an ownership/admin check before fetching data (e.g., verify `inspection.inspector_id === user.id || is_admin_or_above`), or
- (b) Use the user's JWT-scoped client instead of the service role client for data fetching, so RLS enforces access.

---

## Items Verified as Secure (No Changes Needed)

| Area | Status |
|------|--------|
| `cached-admin-status` key is the single source of truth | Confirmed — `cached-super-admin-status` fully eliminated |
| `useRequireAdmin` has offline/transient fallback | Confirmed |
| `useReportEditPermission` has localStorage fallback for admin | Confirmed (V2 fix applied) |
| `getAdminStatusWithCache` calls `is_admin_or_above` | Confirmed (V1 fix applied) |
| Dashboard/Header don't poison cache on transient failure | Confirmed (P0 fix applied) |
| `cached-auth.ts` guards `invalidateUserCache` with `navigator.onLine` | Confirmed (P1 fix applied) |
| `SESSION_REFRESH_BUFFER` is 300s | Confirmed (P2 fix applied) |
| Profile page has offline fallback | Confirmed (Gap 5 fix applied) |
| `InspectionForm` auth listener guards `setCurrentUser(null)` with `navigator.onLine` | Confirmed |
| `TrainingForm` and `DailyAssessmentForm` do not have auth listeners (rely on `useReportEditPermission`) | Confirmed — no gap |
| `send-report-email` validates auth and has rate limiting | Confirmed |
| `generate-training-pdf` authenticates user via JWT | Confirmed |

---

## Implementation Plan

### Step 1: Unify edge function RPC calls
- `supabase/functions/send-training-pdf-email/index.ts` line 79: change `is_super_admin` to `is_admin_or_above`
- `supabase/functions/admin-manage-user/index.ts` line 71: change `is_super_admin` to `is_admin_or_above`

### Step 2: Add authorization check to `generate-inspection-pdf`
- After authenticating the user (line 28-32), add a check: if the fetched `inspection.inspector_id !== user.id`, call `is_admin_or_above` RPC and reject if not admin. This preserves the service-role data fetch (needed for cross-table joins) while enforcing access control.

No database migrations needed. All fixes are backward-compatible.

