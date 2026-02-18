

# Fix: Re-Align Drifted Timestamps for Trainings and Daily Assessments

## Problem

The previous migration successfully fixed inspections (0 drifted), but **all 9 synced trainings** and **3 of 4 synced daily assessments** still have `updated_at > synced_at` on the server. This causes the same perpetual re-sync loop that plagued the Druidia inspection -- but across every training and most daily assessments.

**Why the first fix missed them:** The migration ran the alignment SQL, but the auto-sync cycle (running on the old client build without `align_synced_at` RPC calls) re-synced these records immediately after, re-introducing the drift. The new trigger was active, but the sync transaction updates data fields alongside `synced_at`, so the trigger correctly bumps `updated_at`. Without the post-sync `align_synced_at` call (which the old build lacked), the drift persists.

## Fix

### Database Migration

A single SQL statement to re-align all drifted records:

```sql
-- Re-align trainings (9 records, all drifted)
UPDATE trainings 
SET synced_at = updated_at 
WHERE synced_at IS NOT NULL 
  AND deleted_at IS NULL 
  AND updated_at > synced_at;

-- Re-align daily assessments (3 records drifted)
UPDATE daily_assessments 
SET synced_at = updated_at 
WHERE synced_at IS NOT NULL 
  AND deleted_at IS NULL 
  AND updated_at > synced_at;
```

The updated trigger (already deployed) will preserve `updated_at` during this operation since only `synced_at` is changing. No drift will be re-introduced.

### No Client-Side Changes Needed

The `align_synced_at` RPC calls are already in `atomic-sync-manager.ts` for all three report types (inspections at line 443, trainings at line 984, daily assessments at the equivalent location). Once the current build deploys, future syncs will self-align. This migration is a one-time cleanup for records that drifted before the client code was deployed.

## Impact

- **Scope:** 12 records total (9 trainings + 3 daily assessments)
- **Risk:** Zero. Sets `synced_at = updated_at` on already-synced records. No data modification.
- **Result:** Eliminates all remaining perpetual re-sync loops across the entire database.

