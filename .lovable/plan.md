
# Fix Mobile Synchronization Failure

## Problem Summary

Mobile PWA is failing to synchronize data with the central database. The root causes are:

1. **RLS Policy Missing WITH CHECK** - INSERT operations fail because RLS policies lack explicit WITH CHECK clauses
2. **IndexedDB Timeout Race Condition** - Outer timeout fires before inner operations complete, returning empty arrays
3. **False Success Reporting** - Empty array (from timeout) is treated as "nothing to sync" rather than "failed to fetch"

## Detailed Analysis

### Root Cause 1: RLS Policy INSERT Failure

**Database Error Logs:**
```
ERROR: new row violates row-level security policy for table "inspection_standards"
ERROR: new row violates row-level security policy for table "inspection_summary"
```

**Current Policy Configuration:**
```sql
-- All 5 related tables have this pattern:
cmd: ALL
qual: (EXISTS ( SELECT 1 FROM inspections WHERE inspections.id = [table].inspection_id AND inspections.inspector_id = auth.uid()))
with_check: <nil>  -- PROBLEM: Missing!
```

**Why This Fails:**
When `with_check` is NULL for policies with `cmd = ALL`, PostgreSQL uses the `qual` (USING) expression for INSERT verification. The sync operation does:
1. UPSERT inspection (sets `inspector_id = auth.uid()`)
2. DELETE existing related rows
3. INSERT new related rows

The INSERT fails because the RLS check `(EXISTS (SELECT 1 FROM inspections...))` executes before the inspection row is committed/visible, causing the check to fail.

**Fix:** Add explicit `WITH CHECK (true)` to all child table policies. Since the parent inspection already enforces ownership, child rows just need insertion permission.

### Root Cause 2: IndexedDB Timeout Race Condition

**Console Logs:**
```
[Atomic Sync] IndexedDB timeout getting unsynced inspections
[Atomic Sync] IndexedDB timeout getting unsynced trainings  
[Atomic Sync] IndexedDB timeout getting unsynced assessments
```

**Current Code (atomic-sync-manager.ts line 341-347):**
```typescript
unsynced = await Promise.race([
  getUnsyncedInspections(user.id),  // Has internal 5s timeout + 3s health check = 8s
  new Promise<any[]>((resolve) => setTimeout(() => {
    console.warn('[Atomic Sync] IndexedDB timeout getting unsynced inspections');
    resolve([]);  // PROBLEM: Returns empty array on timeout
  }, 15000))
]);
```

**Problem:** The 15s outer timeout fires before the inner operation completes on slow mobile networks, returning `[]`. The sync then proceeds with "0 items to sync" and reports success.

**Fix:** Differentiate between "timeout" and "empty" results. Return a sentinel value or throw on timeout to indicate failure rather than success.

### Root Cause 3: False Success Reporting

When `unsynced = []` (from timeout), the code proceeds:
```typescript
// Syncs 0 items "successfully"
return { total: 0, success: 0, failed: 0, errors: [] };
```

This shows "Sync completed successfully" toast even though no data was fetched or synced.

## Implementation Plan

### Phase 1: Fix RLS Policies (Database Migration)

Add explicit WITH CHECK clauses to all child table policies:

```sql
-- Drop and recreate policies with explicit WITH CHECK
-- inspection_systems
DROP POLICY IF EXISTS "Users can manage systems for their inspections" ON inspection_systems;
CREATE POLICY "Users can manage systems for their inspections" ON inspection_systems
FOR ALL
USING (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_systems.inspection_id AND inspections.inspector_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_systems.inspection_id AND inspections.inspector_id = auth.uid()));

-- Repeat for: inspection_ziplines, inspection_equipment, inspection_standards, inspection_summary
```

### Phase 2: Fix Timeout Handling (Code Changes)

**File: `src/lib/atomic-sync-manager.ts`**

Update timeout logic to distinguish failures:

```typescript
// Lines 339-351: Replace with proper timeout handling
let unsynced: any[];
let fetchFailed = false;
try {
  const timeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('IndexedDB timeout')), 15000)
  );
  
  unsynced = await Promise.race([
    getUnsyncedInspections(user.id),
    timeoutPromise
  ]);
} catch (e: any) {
  if (e.message === 'IndexedDB timeout') {
    console.warn('[Atomic Sync] IndexedDB timeout - will retry next cycle');
    fetchFailed = true;
  } else {
    console.warn('[Atomic Sync] Failed to get unsynced inspections:', e);
  }
  unsynced = [];
}

// Don't emit success if we failed to fetch data
if (fetchFailed) {
  return { total: -1, success: 0, failed: 0, errors: [{ id: 'indexeddb', error: 'Timeout' }] };
}
```

Apply same pattern to trainings and daily_assessments functions.

### Phase 3: Update Success Reporting (Code Changes)

**File: `src/hooks/useAutoSync.tsx`**

Only show success toast when data was actually synced:

```typescript
// Lines 160-178: Update success handling
if (!syncResult.timedOut) {
  // Check if any sync actually happened or if all returned -1 (fetch failed)
  const results = syncResult.result as any[];
  const allFetchesFailed = results.every(r => r?.total === -1);
  const anySuccess = results.some(r => r?.success > 0);
  
  if (!allFetchesFailed) {
    // Refresh counts and invalidate queries
    updateUnsyncedCounts().catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['inspections'] });
    // ...etc
    
    if (anySuccess) {
      toast.success('Data synced successfully');
      addSyncNotification('Data synced successfully');
    }
    // Always emit completion event to clear error states
    emitSyncComplete();
  } else {
    console.warn('[AutoSync] All fetches failed - not reporting success');
  }
}
```

### Phase 4: Version Update

**File: `vite.config.ts`**

```typescript
const APP_VERSION = "2.2.60";
const BUILD_TIMESTAMP = "02-04-2026 at 11:00 AM CST";
```

## Files to Modify

| File | Changes |
|------|---------|
| **Database Migration** | Add WITH CHECK to 5 child table RLS policies |
| `src/lib/atomic-sync-manager.ts` | Fix timeout handling for inspections, trainings, assessments (3 locations) |
| `src/hooks/useAutoSync.tsx` | Only report success when data actually synced |
| `vite.config.ts` | Increment to v2.2.60 |

## Expected Outcome

After implementation:
1. **RLS INSERT works** - Child tables accept inserts when parent inspection exists
2. **Timeouts distinguished** - Failed fetches don't masquerade as empty results  
3. **Accurate feedback** - Toast only shows success when data actually synced
4. **Mobile sync works** - Data reliably persists to central database

## Migration SQL Preview

```sql
-- Fix inspection_systems
DROP POLICY IF EXISTS "Users can manage systems for their inspections" ON inspection_systems;
CREATE POLICY "Users can manage systems for their inspections" ON inspection_systems
FOR ALL USING (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_systems.inspection_id AND inspections.inspector_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_systems.inspection_id AND inspections.inspector_id = auth.uid()));

-- Fix inspection_ziplines  
DROP POLICY IF EXISTS "Users can manage ziplines for their inspections" ON inspection_ziplines;
CREATE POLICY "Users can manage ziplines for their inspections" ON inspection_ziplines
FOR ALL USING (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_ziplines.inspection_id AND inspections.inspector_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_ziplines.inspection_id AND inspections.inspector_id = auth.uid()));

-- Fix inspection_equipment
DROP POLICY IF EXISTS "Users can manage equipment for their inspections" ON inspection_equipment;
CREATE POLICY "Users can manage equipment for their inspections" ON inspection_equipment
FOR ALL USING (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_equipment.inspection_id AND inspections.inspector_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_equipment.inspection_id AND inspections.inspector_id = auth.uid()));

-- Fix inspection_standards
DROP POLICY IF EXISTS "Users can manage standards for their inspections" ON inspection_standards;
CREATE POLICY "Users can manage standards for their inspections" ON inspection_standards
FOR ALL USING (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_standards.inspection_id AND inspections.inspector_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_standards.inspection_id AND inspections.inspector_id = auth.uid()));

-- Fix inspection_summary
DROP POLICY IF EXISTS "Users can manage summary for their inspections" ON inspection_summary;
CREATE POLICY "Users can manage summary for their inspections" ON inspection_summary
FOR ALL USING (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_summary.inspection_id AND inspections.inspector_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_summary.inspection_id AND inspections.inspector_id = auth.uid()));
```
