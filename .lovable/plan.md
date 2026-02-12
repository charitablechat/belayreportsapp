
# Zero Data Loss Architecture: Comprehensive Protection Plan

## Executive Summary

After a thorough audit of every file that touches report data, I found **3 critical destructive patterns** that can silently wipe user-entered data. This plan eliminates ALL of them and adds safeguards to guarantee that no data is ever removed except by explicit user action (clicking a delete button).

---

## Findings: All Destructive Patterns Identified

### CRITICAL 1: Atomic Sync Manager -- Delete-Then-Insert (ALL 3 report types)

**File:** `src/lib/atomic-sync-manager.ts`

The background sync system uses a **delete-all-rows-then-insert** pattern for child tables. If the local IndexedDB has empty arrays (e.g., user never visited that tab, or IndexedDB read failed), the delete executes but nothing is inserted -- wiping the server data permanently.

**Affected lines:**
- Inspections: lines 334-358 (delete inspection_systems, ziplines, equipment, standards, summary)
- Trainings: lines 843-870 (delete training_delivery_approaches, operating_systems, immediate_attention, verifiable_items, systems_in_place, summary)
- Daily Assessments: lines 1283-1310 (delete daily_assessment_beginning_of_day, end_of_day, operating_systems, equipment_checks, structure_checks, environment_checks)

**Risk:** This runs automatically in the background every 30 minutes and on every online event. If IndexedDB returns empty data for ANY reason (corruption, quota exceeded, browser GC), the sync will delete all server-side child data for that report.

### CRITICAL 2: Transaction Manager -- Supports "delete" Operation

**File:** `src/lib/transaction-manager.ts` (lines 79-84, 148-157)

The transaction manager has a `delete` operation type that is actively used by the atomic sync manager. The rollback mechanism attempts to re-insert deleted data on failure, but if the rollback itself fails (network timeout, quota error), the data is gone permanently.

### MODERATE 3: Dashboard Orphan Cleanup -- Local Data Deletion

**File:** `src/pages/Dashboard.tsx` (lines 388-391, 479-482, 570-573)

When the dashboard fetches reports from the server, it deletes any local IndexedDB records not found on the server (excluding temp- IDs). This is generally safe but could delete local data if:
- The server query hits the 1000-row limit and returns an incomplete list
- A network timeout returns partial results
- RLS policy changes make records invisible

---

## The Fix: Upsert-Only Architecture

### Change 1: Replace ALL delete-then-insert with upsert in `atomic-sync-manager.ts`

For each of the 3 report types, replace the destructive pattern:

```text
BEFORE (dangerous):
  Step 2: DELETE all child rows WHERE parent_id = X
  Step 3: INSERT child rows (skipped if array empty = DATA LOSS)

AFTER (safe):
  Step 2: UPSERT child rows (insert or update, never delete)
  -- No delete step exists. Empty arrays simply skip the upsert.
  -- Existing server rows are preserved untouched.
```

**Inspection sync** (lines 334-407): Remove the 5 delete steps. Change the 5 insert steps to upsert operations.

**Training sync** (lines 843-926): Remove the 6 delete steps. Change the 6 insert steps to upsert operations.

**Daily Assessment sync** (lines 1283-1360): Remove the 6 delete steps. Change the 6 insert steps to upsert operations.

Each upsert will use `onConflict: 'id'` to update existing rows or insert new ones.

### Change 2: Remove "delete" operation from `transaction-manager.ts`

Since no code path should ever use destructive deletes for report data, remove the `delete` case from `executeTransaction()` and its rollback handler. This acts as a compile-time/runtime guard: even if someone accidentally adds a delete step in the future, the transaction manager will reject it.

**Alternative (safer):** Instead of removing it entirely (since it may be needed for non-report operations in the future), add a guard that logs a loud warning and blocks execution if a delete is attempted on any report-related table.

### Change 3: Add empty-array safeguard to sync functions

Before syncing, verify that local data is not suspiciously empty when server data exists. If the server has 10 child records but local has 0, this is almost certainly a data loss scenario -- skip the sync for that entity and log a warning.

```text
// Pseudo-code for each sync function:
if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
  // Check if local data is suspiciously empty
  const serverHasData = existingApproaches.length > 0 || existingSystems.length > 0 ...;
  const localIsEmpty = delivery_approaches.length === 0 && operating_systems.length === 0 ...;
  
  if (serverHasData && localIsEmpty) {
    console.error('[SAFETY] Blocked sync: server has data but local is empty');
    return { success: false, skipped: true, reason: 'empty_local_guard' };
  }
}
```

### Change 4: Protect Dashboard orphan cleanup from incomplete server responses

Add a minimum threshold check: if the server returns fewer records than expected (e.g., less than the local count minus some tolerance), skip orphan cleanup entirely.

```text
// Only clean up orphans if server returned a credible number of records
const localCount = localInspections.filter(l => !l.id.startsWith('temp-')).length;
if (networkData.length < localCount * 0.5 && localCount > 3) {
  console.warn('[Dashboard] Server returned far fewer records than local -- skipping orphan cleanup');
  return; // Don't delete anything
}
```

---

## Files Modified

| File | Change | Risk Level |
|------|--------|------------|
| `src/lib/atomic-sync-manager.ts` | Replace delete-then-insert with upsert for ALL 3 report types + add empty-array guard | CRITICAL |
| `src/lib/transaction-manager.ts` | Add blocklist for delete operations on report tables | MODERATE |
| `src/pages/Dashboard.tsx` | Add threshold guard to orphan cleanup | LOW |

## Files NOT Modified (Already Safe)

| File | Status | Why |
|------|--------|-----|
| `src/pages/TrainingForm.tsx` | Already fixed | Previous fix replaced delete-then-insert with upsert in `completeTraining()` |
| `src/pages/InspectionForm.tsx` | Safe | `completeInspection()` only updates status, no child table manipulation |
| `src/pages/DailyAssessmentForm.tsx` | Safe | `handleSubmit()` already uses upsert pattern |
| `src/components/PhotoGallery.tsx` | Safe | Photo delete is user-initiated (explicit button click) |
| `src/hooks/useEmptyReportCleanup.tsx` | Safe | Uses soft-delete (sets deleted_at), not hard delete |
| `src/hooks/useSoftDelete.tsx` | Safe | User-initiated soft-delete only |

## What This Guarantees

After implementation:
1. No background process can ever delete report child data
2. No sync operation can ever wipe data due to empty local state
3. The only way data is removed is by explicit user action (delete button)
4. Page refresh, offline-to-online transitions, and background sync are all non-destructive
5. Photos are only deletable via the user-facing delete button in PhotoGallery
6. The transaction manager will block any future accidental delete operations on report tables
