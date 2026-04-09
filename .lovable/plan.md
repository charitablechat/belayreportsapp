

# Sync Engine Final Audit: Remaining Gaps

After reviewing all sync-related code (`atomic-sync-manager.ts`, `useAutoSync.tsx`, `sw-sync.js`, `offline-storage.ts`, `sync-manager.ts`, `sync-reconciliation.ts`, `transaction-manager.ts`, `cached-auth.ts`, `environment.ts`, all RLS policies, and recent DB logs), here is the assessment:

## Status: Main Thread Sync — SOLID

The main thread sync pipeline (`atomic-sync-manager.ts` + `useAutoSync.tsx`) is robust. The recent fixes (getUnsynced scan, early-return guard, dead code cleanup) resolved all identified issues. No new gaps found.

## Status: Service Worker Sync — SOLID

The recent Bug 1-7 fixes (join stripping, photo paths, temp-ID guards, index names, client deferral) addressed all critical SW issues. The SW now correctly defers to the main thread when clients are active, uses proper index names for trainings/assessments, and strips joined objects.

## Status: RLS Policies — SOLID

The admin child table migration successfully added `is_admin_or_above()` policies to all 20 child tables. DB logs show zero errors.

---

## Remaining Issues Found

### Bug 11 (LOW): `transaction-manager.ts` missing `daily_assessment_photos` in blocklist

**File:** `src/lib/transaction-manager.ts`, line 26-29

The `REPORT_TABLE_BLOCKLIST` (which blocks accidental DELETE operations) includes all child tables but is **missing `daily_assessment_photos`**. If a malformed transaction step tried to delete assessment photos, the guard wouldn't catch it.

Current list includes `inspection_photos` and `training_photos` but not `daily_assessment_photos`.

**Fix:** Add `'daily_assessment_photos'` to the blocklist Set.

### Bug 12 (LOW): `sync_conflicts` table missing admin policies

The `sync_conflicts` table only has policies for `super_admin` SELECT and owner-based CRUD. If an admin syncs another user's inspection and a conflict is detected, the INSERT to `sync_conflicts` will fail with an RLS violation because the admin doesn't own the inspection referenced by `inspection_id`.

The `sync_conflicts` user policies check:
```sql
EXISTS (SELECT 1 FROM inspections WHERE inspections.id = sync_conflicts.inspection_id AND inspections.inspector_id = auth.uid())
```

An admin syncing Brenda's inspection would fail this check since `inspector_id != admin.uid()`.

**Fix:** Add `is_admin_or_above()` ALL policy on `sync_conflicts`.

### Bug 13 (COSMETIC): `report_deleted_items` missing admin INSERT policy

When an admin syncs another user's report, the reconciliation in `sync-reconciliation.ts` logs deleted child rows to `report_deleted_items` with `deleted_by = auth.uid()`. The INSERT policy checks `deleted_by = auth.uid()` which works. However, admins cannot VIEW these entries (only super_admin and the original owner can). This means an admin who reconciles data cannot verify their own reconciliation audit trail.

**Fix:** Add `is_admin_or_above()` SELECT policy on `report_deleted_items`.

---

## Verified — No Issues

| Area | Status | Notes |
|------|--------|-------|
| `getUnsyncedInspections/Trainings/Assessments` | OK | `getAll()` + filter working |
| Temp-ID handling (main thread) | OK | UUID swap + dedup guard + child propagation |
| Temp-ID handling (SW) | OK | Skips temp-IDs per Bug 3 fix |
| Photo sync (`sync-manager.ts`) | OK | Per-photo metadata, pending path normalization |
| SW photo sync | OK | Uses `photoUrl`, per-photo bucket/table |
| Field-count regression guard | OK | 3-skip override prevents permanent blocks |
| Empty-local guard + recovery | OK | Pulls server data into IndexedDB on mismatch |
| Reconciliation (`sync-reconciliation.ts`) | OK | 50% partial-read guard, audit logging |
| Circuit breaker | OK | Exponential backoff, health probe |
| Auth session management | OK | Single validation per cycle, LockManager guard |
| Realtime subscriptions | OK | Post-sync cooldown, 3-error unsubscribe |
| Stale upload detection | OK | 5-minute warning |
| Accelerated drain | OK | 5s re-sync for large queues |
| DB version alignment | OK | Version 9 in both `db-config.js` and `offline-storage.ts` |
| Lovable preview guard | OK | Blocks all writes in preview |
| DB error logs | OK | Zero errors in recent logs |
| Parent table RLS | OK | Admin access on all 3 parent tables |
| Child table RLS | OK | Admin access on all 20 child tables |
| `invoiced_reports` RLS | OK | Admin ALL policy exists |

## Plan

### Step 1: Add `daily_assessment_photos` to transaction blocklist
**File:** `src/lib/transaction-manager.ts`
Add the missing entry to the `REPORT_TABLE_BLOCKLIST` Set.

### Step 2: Add admin policies for `sync_conflicts` and `report_deleted_items`
**Migration:** Add `is_admin_or_above()` policies for admin access.

### Files to change

| File | Change |
|------|--------|
| `src/lib/transaction-manager.ts` | Add `daily_assessment_photos` to blocklist |
| New migration | Admin policies for `sync_conflicts` and `report_deleted_items` |

These are all low-severity items. The sync engine is production-ready for all critical paths.

