
# Complete Soft-Delete Sync Safeguard Fix (v2.3.7)

## Problem Summary

The current soft-delete detection safeguard implemented in `atomic-sync-manager.ts` has a **critical flaw** that prevents it from working for regular users:

### Root Cause

RLS policies require `deleted_at IS NULL` for regular users to SELECT their own records:

```text
"Users can view their own active inspections" 
  → qual: ((inspector_id = auth.uid()) AND (deleted_at IS NULL))
```

When the sync manager queries:
```sql
SELECT updated_at, deleted_at, deleted_by FROM inspections WHERE id = '...'
```

For a soft-deleted record, RLS **blocks the entire row** - returning `null` instead of a row with `deleted_at` populated. The safeguard check `if (remoteInspection?.deleted_at)` never triggers.

---

## Solution Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                    CURRENT (BROKEN)                              │
├──────────────────────────────────────────────────────────────────┤
│  User Sync → SELECT deleted_at → RLS BLOCKS → null returned     │
│            → Check null?.deleted_at → false → UPSERT fails      │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                    FIXED APPROACH                                │
├──────────────────────────────────────────────────────────────────┤
│  User Sync → RPC check_record_deleted() → SECURITY DEFINER      │
│            → Bypasses RLS → Returns {exists, deleted, updated}  │
│            → Correct detection → Clean up local copy            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Step 1: Create Security Definer Function (Database Migration)

Create a function that can check deletion status regardless of RLS:

```sql
-- Check if a record is soft-deleted (for sync manager use)
-- Security definer allows checking status even when RLS blocks SELECT
CREATE OR REPLACE FUNCTION check_record_status(
  p_table_name TEXT,
  p_record_id UUID
) RETURNS TABLE (
  record_exists BOOLEAN,
  is_deleted BOOLEAN,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID,
  updated_at TIMESTAMPTZ
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate table name to prevent SQL injection
  IF p_table_name NOT IN ('inspections', 'trainings', 'daily_assessments') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;
  
  -- Use dynamic SQL with validated table name
  IF p_table_name = 'inspections' THEN
    RETURN QUERY
    SELECT 
      TRUE as record_exists,
      i.deleted_at IS NOT NULL as is_deleted,
      i.deleted_at,
      i.deleted_by,
      i.updated_at
    FROM inspections i
    WHERE i.id = p_record_id;
  ELSIF p_table_name = 'trainings' THEN
    RETURN QUERY
    SELECT 
      TRUE as record_exists,
      t.deleted_at IS NOT NULL as is_deleted,
      t.deleted_at,
      t.deleted_by,
      t.updated_at
    FROM trainings t
    WHERE t.id = p_record_id;
  ELSIF p_table_name = 'daily_assessments' THEN
    RETURN QUERY
    SELECT 
      TRUE as record_exists,
      da.deleted_at IS NOT NULL as is_deleted,
      da.deleted_at,
      da.deleted_by,
      da.updated_at
    FROM daily_assessments da
    WHERE da.id = p_record_id;
  END IF;
  
  -- If no rows returned, record doesn't exist
  RETURN;
END;
$$;
```

### Step 2: Update Atomic Sync Manager

**File: `src/lib/atomic-sync-manager.ts`**

Replace direct SELECT queries with RPC calls:

```typescript
// BEFORE (broken for regular users)
const { data: remoteInspection } = await supabase
  .from("inspections")
  .select("updated_at, deleted_at, deleted_by")
  .eq("id", inspectionId)
  .maybeSingle();

if (remoteInspection?.deleted_at) { ... }

// AFTER (works for all users)
const { data: recordStatus } = await supabase
  .rpc('check_record_status', { 
    p_table_name: 'inspections', 
    p_record_id: inspectionId 
  })
  .maybeSingle();

// Check if record exists but is deleted
if (recordStatus?.record_exists && recordStatus?.is_deleted) {
  console.warn('[Atomic Sync] Remote record was soft-deleted - cleaning up local copy:', inspectionId);
  // ... cleanup logic
}

// Use recordStatus.updated_at for conflict detection
if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
  const remoteUpdated = new Date(recordStatus.updated_at).getTime();
  // ... conflict detection
}
```

Apply the same pattern to:
- `syncTrainingAtomic()` - Line ~604
- `syncDailyAssessmentAtomic()` - Line ~1008

### Step 3: Create Helper Function

**File: `src/lib/atomic-sync-manager.ts`** (new helper)

```typescript
interface RecordStatus {
  record_exists: boolean;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
  updated_at: string | null;
}

async function checkRemoteRecordStatus(
  tableName: 'inspections' | 'trainings' | 'daily_assessments',
  recordId: string
): Promise<RecordStatus | null> {
  const { data, error } = await supabase
    .rpc('check_record_status', {
      p_table_name: tableName,
      p_record_id: recordId
    })
    .maybeSingle();
  
  if (error) {
    console.error('[Atomic Sync] Error checking record status:', error);
    return null;
  }
  
  return data as RecordStatus | null;
}
```

### Step 4: Deprecate Legacy Sync Functions (Optional but Recommended)

**File: `src/lib/sync-manager.ts`**

Add deprecation warnings to prevent future use:

```typescript
/**
 * @deprecated Use syncAllInspectionsAtomic from atomic-sync-manager.ts instead
 * This function does not handle soft-deleted records correctly
 */
export async function syncInspections() {
  console.warn('[Sync Manager] DEPRECATED: Use syncAllInspectionsAtomic instead');
  // ... existing code
}
```

### Step 5: Version Bump

Update `vite.config.ts` to version **2.3.7**.

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/migrations/xxx.sql` | Create `check_record_status()` function |
| `src/lib/atomic-sync-manager.ts` | Replace SELECT with RPC, add helper function |
| `src/lib/sync-manager.ts` | Add deprecation warnings (optional) |
| `vite.config.ts` | Version bump to 2.3.7 |

---

## Testing Checklist

After implementation:

1. **Regular User Test**: 
   - Create a report, save locally (offline or before sync)
   - Super Admin soft-deletes the report
   - User comes online → sync should detect deletion and clean up local copy
   
2. **Super Admin Test**:
   - Super Admin can still see and restore deleted reports
   - Super Admin sync continues to work normally

3. **New Records Test**:
   - New reports sync correctly (no false positives from status check)

4. **Conflict Detection Test**:
   - Concurrent edits still detected and handled via Last Write Wins

---

## Why This Fix is Complete for All Users

1. **Security Definer Function**: Bypasses RLS to check deletion status without exposing deleted data
2. **Validates Table Names**: Prevents SQL injection in the RPC
3. **Works for All Users**: Regular users can now detect admin deletions
4. **Future-Proof**: Any new sync paths using this function will have the safeguard
5. **No Data Exposure**: Only returns status information, not the deleted record's content
