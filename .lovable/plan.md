
# Comprehensive Cleanup and Fix Plan - v2.4.2

## Issues Identified

### 1. Ghost-Synced Records (7 total)
Records that have `synced_at` set but are missing ALL child data (created pre-v2.3.8):

| Report Type | Organization | ID | Status |
|------------|--------------|-----|--------|
| **Inspection** | Camp of the Hills | `8acbee15-4dcd-4173-93ba-8c14a5ec7900` | draft |
| **Training** | Cal Farley's | `77b120a3-df7f-4c0e-a77b-df33f2ea3ed8` | draft |
| **Training** | Camp Lone Star - La Grange | `fef2e241-0c29-4094-8c15-dc58ad3a7ca7` | completed |
| **Daily Assessment** | Santa's Workshop | `b840ebe8-b4c2-48af-92ba-83a0f936592b` | completed |
| **Daily Assessment** | Cloud City | `92bbb88e-98a1-4e00-aedc-9db248bfd081` | draft |
| **Daily Assessment** | Mango Tractor | `42bdb28a-0587-43cf-9bd3-3fd5cb3ea1de` | draft |
| **Daily Assessment** | Cloud City | `03fe57b6-fcb6-42a2-8acd-031bbd5b1eaf` | draft |

### 2. Unresolved Sync Conflict (1 total)
| Organization | Inspection ID | Created |
|-------------|---------------|---------|
| Twin Lakes Family YMCA | `f44d0658-7563-48e5-956a-751215290966` | Feb 5, 2026 |

### 3. Code Issues to Clean Up

**useSyncStatus.tsx** - Unused hook (replaced by useAutoSync):
- The `useSyncStatus` hook is no longer used in the codebase
- PWAProvider uses `useAutoSync` for all sync functionality
- Should be removed to prevent confusion and dead code

**sync-manager.ts** - Deprecated functions still exist:
- `syncInspections()`, `syncDailyAssessments()`, `syncTrainings()` are deprecated
- These bypass the atomic sync manager and don't handle soft-deleted records correctly
- Already marked with `@deprecated` comments but could cause issues if accidentally used

---

## Solution

### Phase 1: Database Cleanup (Migration)

Reset `synced_at` to NULL for ghost-synced records so they will re-sync with complete child data on next mobile sync:

```sql
-- Reset ghost-synced inspection
UPDATE inspections 
SET synced_at = NULL 
WHERE id = '8acbee15-4dcd-4173-93ba-8c14a5ec7900';

-- Reset ghost-synced trainings
UPDATE trainings 
SET synced_at = NULL 
WHERE id IN (
  '77b120a3-df7f-4c0e-a77b-df33f2ea3ed8',
  'fef2e241-0c29-4094-8c15-dc58ad3a7ca7'
);

-- Reset ghost-synced daily assessments
UPDATE daily_assessments 
SET synced_at = NULL 
WHERE id IN (
  'b840ebe8-b4c2-48af-92ba-83a0f936592b',
  '92bbb88e-98a1-4e00-aedc-9db248bfd081',
  '42bdb28a-0587-43cf-9bd3-3fd5cb3ea1de',
  '03fe57b6-fcb6-42a2-8acd-031bbd5b1eaf'
);

-- Auto-resolve stale sync conflict (older than 24 hours)
UPDATE sync_conflicts 
SET resolved = true 
WHERE id = '7a84bbae-2673-4f0a-9cd3-ade43eb1dea2';
```

### Phase 2: Code Cleanup

1. **Delete `src/hooks/useSyncStatus.tsx`**
   - Unused hook that duplicates functionality in `useAutoSync`
   - Reduces confusion and dead code

2. **Add runtime protection in sync-manager.ts**
   - Throw explicit errors if deprecated functions are called
   - Ensures no accidental usage bypasses atomic sync

### Phase 3: Version Bump

Update to **v2.4.2** with changelog:
- Fixed 7 ghost-synced records (reset synced_at for re-sync)
- Resolved stale sync conflict for Twin Lakes Family YMCA
- Removed unused useSyncStatus hook
- Hardened deprecated sync functions with runtime errors

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| Database migration | Create | Reset synced_at on ghost records, resolve conflict |
| `src/hooks/useSyncStatus.tsx` | Delete | Remove unused hook |
| `src/lib/sync-manager.ts` | Update | Add runtime throws for deprecated functions |
| `vite.config.ts` | Update | Bump to v2.4.2 |

---

## Expected Outcome

After this fix:
1. Ghost-synced records will show as "pending sync" and re-sync with complete child data
2. No stale conflicts remain in the system
3. Cleaner codebase with no unused hooks
4. Runtime protection prevents accidental use of deprecated sync functions
5. Sync health: All 32 total reports will have complete data integrity

---

## Testing Checklist

1. Verify the 7 ghost-synced records show synced_at = NULL in database
2. Confirm sync conflict is resolved
3. Test that deleting useSyncStatus.tsx doesn't break any imports
4. Verify PWAProvider still works correctly with useAutoSync
5. Test mobile sync to ensure ghost-synced records re-sync with child data
