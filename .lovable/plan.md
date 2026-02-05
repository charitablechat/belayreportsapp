
# Sync Failure Fix Plan (v2.3.8)

## Root Cause Summary

The synchronization system has a **critical bug** that causes **partial sync failures** to go undetected:

1. **Premature `synced_at` marking**: The parent inspection's `synced_at` timestamp is set in Step 1 of the transaction, but related data (standards, summary, etc.) is inserted in later steps
2. **Incomplete rollback data**: The rollback mechanism only stores `updated_at`, not the original `synced_at` value, so failed transactions cannot properly restore the pre-sync state
3. **RLS timing issues**: Related table RLS policies query the parent inspection, but if the parent is being modified mid-transaction, the RLS check can fail

**Evidence from database:**
- Multiple inspections show `synced_at` timestamp but have **0 standards and 0 summary records**
- Database logs show RLS policy violations on `inspection_summary` and `inspection_standards` tables

---

## Solution Architecture

```text
BEFORE (Broken):
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: UPSERT inspection (synced_at = NOW) ← Sets too early   │
│ Step 2-6: DELETE existing related data                          │
│ Step 7-11: INSERT new related data ← RLS fails here sometimes   │
│ Result: inspection marked as synced, but data is missing        │
└─────────────────────────────────────────────────────────────────┘

AFTER (Fixed):
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: UPSERT inspection (synced_at = NULL preserved)          │
│ Step 2-6: DELETE existing related data                          │
│ Step 7-11: INSERT new related data                              │
│ Step 12: UPDATE inspection SET synced_at = NOW ← Only on success│
│ Result: synced_at only set after ALL data committed             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Fix Transaction Order in Atomic Sync Manager

**File: `src/lib/atomic-sync-manager.ts`**

Modify `syncInspectionAtomic()`, `syncTrainingAtomic()`, and `syncDailyAssessmentAtomic()` to:

1. **Defer `synced_at` update** - Don't set `synced_at` in the initial upsert
2. **Add final step** - Set `synced_at` only AFTER all related data is successfully inserted
3. **Fix rollback data** - Capture the complete original record including `synced_at` for proper rollback

For inspections (and similar pattern for trainings/assessments):
```typescript
// Step 1: Upsert inspection WITHOUT synced_at change
steps.push({
  table: 'inspections',
  operation: 'upsert',
  data: {
    ...inspectionWithoutJoin,
    // DO NOT set synced_at here
  },
  rollbackData: recordStatus?.record_exists 
    ? { synced_at: recordStatus.synced_at, updated_at: recordStatus.updated_at } 
    : null,
});

// ... all other steps (delete + insert related data) ...

// FINAL STEP: Set synced_at ONLY after all data committed
steps.push({
  table: 'inspections',
  operation: 'update',
  data: { synced_at: new Date().toISOString() },
  filter: { id: inspectionId },
});
```

### Step 2: Update check_record_status RPC to Include synced_at

**Database Migration Required**

The `check_record_status` RPC function needs to return `synced_at` for proper rollback:

```sql
-- Add synced_at to the return type
DROP FUNCTION IF EXISTS public.check_record_status(text, uuid);

CREATE OR REPLACE FUNCTION public.check_record_status(
  p_table_name TEXT,
  p_record_id UUID
) RETURNS TABLE (
  record_exists BOOLEAN,
  is_deleted BOOLEAN,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID,
  updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ  -- NEW: for rollback
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_table_name NOT IN ('inspections', 'trainings', 'daily_assessments') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;
  
  IF p_table_name = 'inspections' THEN
    RETURN QUERY
    SELECT TRUE, i.deleted_at IS NOT NULL, i.deleted_at, i.deleted_by, i.updated_at, i.synced_at
    FROM inspections i WHERE i.id = p_record_id;
  ELSIF p_table_name = 'trainings' THEN
    RETURN QUERY
    SELECT TRUE, t.deleted_at IS NOT NULL, t.deleted_at, t.deleted_by, t.updated_at, t.synced_at
    FROM trainings t WHERE t.id = p_record_id;
  ELSIF p_table_name = 'daily_assessments' THEN
    RETURN QUERY
    SELECT TRUE, da.deleted_at IS NOT NULL, da.deleted_at, da.deleted_by, da.updated_at, da.synced_at
    FROM daily_assessments da WHERE da.id = p_record_id;
  END IF;
  
  RETURN;
END;
$$;
```

### Step 3: Update RecordStatus Interface

**File: `src/lib/atomic-sync-manager.ts`**

Add `synced_at` to the interface:

```typescript
interface RecordStatus {
  record_exists: boolean;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
  updated_at: string | null;
  synced_at: string | null;  // NEW
}
```

### Step 4: Add Orphan Detection for Existing Corrupt Data

**File: `src/lib/atomic-sync-manager.ts`**

Add a helper function to detect and fix inspections marked as synced but missing related data:

```typescript
/**
 * Detect and mark inspections that appear synced but are actually incomplete
 * This fixes "ghost synced" records from past partial sync failures
 */
async function detectAndFixOrphanedSyncState(inspectionId: string): Promise<boolean> {
  // Query related data counts
  const [standards, summary] = await Promise.all([
    supabase.from('inspection_standards').select('id', { count: 'exact' }).eq('inspection_id', inspectionId),
    supabase.from('inspection_summary').select('id', { count: 'exact' }).eq('inspection_id', inspectionId),
  ]);
  
  // If remote has 0 standards or 0 summary but inspection shows synced_at,
  // this is an orphaned sync state - reset synced_at to trigger re-sync
  const missingData = (standards.count === 0) || (summary.count === 0);
  
  if (missingData) {
    console.warn('[Atomic Sync] Detected orphaned sync state - resetting synced_at:', inspectionId);
    await supabase
      .from('inspections')
      .update({ synced_at: null })
      .eq('id', inspectionId);
    return true;
  }
  
  return false;
}
```

### Step 5: Version Bump

**File: `vite.config.ts`**

Update version to 2.3.8

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/migrations/xxx.sql` | Update `check_record_status()` to include `synced_at` |
| `src/lib/atomic-sync-manager.ts` | Fix transaction order, add orphan detection |
| `vite.config.ts` | Version 2.3.8 |

---

## Technical Details

### Why the Current Approach Fails

1. **Transaction Step 1** upserts inspection with `synced_at: NOW()`
2. **Transaction Steps 7-11** insert related data (standards, summary)
3. If Step 9 (`inspection_standards` INSERT) fails with RLS error:
   - Rollback attempts to restore inspection
   - But rollback only has `updated_at`, not `synced_at`
   - Inspection keeps the incorrect `synced_at` timestamp
   - Related data was deleted (Step 2-6) but not re-inserted
   - Result: "Ghost synced" inspection with missing data

### Why the Fix Works

1. **Transaction Step 1** upserts inspection **WITHOUT** changing `synced_at`
2. **Transaction Steps 2-11** handle all delete/insert operations for related data
3. **Transaction Step 12** (FINAL) sets `synced_at` only after ALL other steps succeed
4. If ANY step fails:
   - Rollback properly restores original `synced_at` (now captured in rollbackData)
   - The inspection remains in unsynced state
   - Next sync attempt will retry the complete package

### Rollback Data Improvement

**Before:** `{ updated_at: recordStatus.updated_at }`
**After:** `{ synced_at: recordStatus.synced_at, updated_at: recordStatus.updated_at }`

This ensures rollback can restore the original sync state.

---

## Testing Checklist

After implementation:

1. **Partial Failure Test**
   - Temporarily add a failing step to simulate RLS error
   - Verify inspection `synced_at` remains NULL after failed sync
   - Verify related data is properly rolled back

2. **Success Case Test**
   - Complete a full sync with all data
   - Verify `synced_at` is set AFTER all related data exists in database
   - Verify related data counts match local data

3. **Orphan Detection Test**
   - Manually set `synced_at` on an inspection with 0 standards
   - Trigger sync and verify it detects orphan state
   - Verify `synced_at` is reset and full re-sync occurs

4. **Mobile Sync Test**
   - Create report on mobile device
   - Add systems, equipment, standards, summary
   - Verify complete sync to database
   - Check Super Admin can view all data

---

## Why This Fix is Complete

1. **Atomic Guarantee**: `synced_at` only set after ALL related data commits
2. **Proper Rollback**: Original `synced_at` captured and restored on failure
3. **Orphan Recovery**: Detects and fixes existing corrupt sync states
4. **Applies to All Types**: Same pattern for inspections, trainings, and assessments
5. **No RLS Changes Needed**: Works within existing security model
