

# Fix: Temp-ID to UUID Swap Missing in Training and Daily Assessment Sync

## Root Cause

The database logs show the error `invalid input syntax for type uuid: "temp-1770737793484-119jf23me"` repeating every 2 seconds. This is the "Aspen report" stuck in an infinite sync loop.

**The bug:** `syncTrainingAtomic()` and `syncDailyAssessmentAtomic()` in `atomic-sync-manager.ts` are missing the temp-to-UUID swap that `syncInspectionAtomic()` already has (lines 117-128). When a training or daily assessment is created offline, it gets a `temp-` prefixed ID. During sync:

1. The `temp-` ID is passed to `checkRemoteRecordStatus` RPC, which expects a UUID type -- PostgreSQL rejects it
2. The function returns `null` (error caught), sync continues
3. The upsert to the database table also fails because `temp-` is not a valid UUID
4. The error is caught, the record stays unsynced in IndexedDB
5. Next sync cycle (every 5-30 seconds) picks it up again -- infinite loop

The inspection sync already handles this correctly (lines 117-128 of `atomic-sync-manager.ts`). The training and daily assessment sync paths were never given the same treatment.

## Fix (1 file, 2 changes)

### File: `src/lib/atomic-sync-manager.ts`

#### Change 1: Add temp-to-UUID swap to `syncTrainingAtomic()` (~line 797)

After the training is loaded from IndexedDB but before any database calls, add the same temp-ID detection and UUID replacement pattern used in `syncInspectionAtomic`:

- Detect if `training.id` starts with `temp-`
- Generate a real UUID via `crypto.randomUUID()`
- Track the old-to-new mapping for post-sync IndexedDB cleanup
- Propagate the new UUID to all child records (delivery_approaches, operating_systems, etc.)
- After successful sync, delete the old `temp-` keyed entry from IndexedDB and save under the new UUID

#### Change 2: Add temp-to-UUID swap to `syncDailyAssessmentAtomic()` (~line 1331)

Same pattern as above, adapted for daily assessments:

- Detect if `assessment.id` starts with `temp-`
- Generate a real UUID
- Track mapping for IndexedDB cleanup
- Propagate UUID to all child records (beginning_of_day, end_of_day, operating_systems, equipment_checks, structure_checks, environment_checks)
- Post-sync cleanup of old temp entries

## What Does NOT Change

- `syncInspectionAtomic` -- already has the fix
- No UI or styling changes
- No database schema changes
- No changes to auto-save logic, debounce intervals, or sync scheduling
- No changes to the `useAutoSync` hook or `PWAProvider`
- The existing validation, conflict detection, empty-local-guard, and field-count regression guard all remain intact

## Why This Fixes the Infinite Loop

Once the temp ID is swapped to a real UUID before any database calls:
- `checkRemoteRecordStatus` receives a valid UUID -- no more PostgreSQL errors
- The upsert succeeds with the real UUID
- `synced_at` and `updated_at` are aligned post-sync
- The record is no longer flagged as "unsynced" in IndexedDB
- The sync loop stops

## Technical Details

The implementation mirrors the existing inspection pattern exactly:

```text
1. Load record from IndexedDB
2. IF id starts with 'temp-':
   a. Generate new UUID
   b. Save mapping { oldId, newId }
   c. Update record.id and function parameter
3. Validate session, ownership
4. Fetch child records using OLD id (stored under temp key in IndexedDB)
5. Propagate new UUID to child record foreign keys
6. Transform child temp IDs to UUIDs (already done)
7. Validate, check remote status, build transaction steps
8. Execute transaction
9. Post-sync: delete old temp entries, save under new UUID
```

