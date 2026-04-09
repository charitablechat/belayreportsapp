

# Fix: Restored Reports — Full Access Blocked by Broken Sync

## Root Cause

The **sync engine is completely broken** right now. All three `getUnsynced*` functions crash with:
```
DataError: Failed to execute 'only' on 'IDBKeyRange': The parameter is not a valid key.
```

This happens because `IDBKeyRange.only(undefined)` is invalid — IndexedDB does not index records where the key path value is `undefined`. Records with `synced_at = undefined` simply don't appear in the `by-synced` index at all.

This means **no reports can sync**, which blocks saving, completing, and invoicing for ALL reports (not just restored ones).

The report itself (`3c7c3fca-083d-4b8b-a7db-3c1464ea0e3c`, "Airiel Crawler World", owned by Brenda) has correct permissions — `deleted_at = null`, `status = draft`. The permission model grants Brenda (owner + admin) full edit access. The blocker is that changes can't be persisted because sync crashes on startup.

## Fix

### 1. Fix `getUnsyncedInspections` / `getUnsyncedDailyAssessments` / `getUnsyncedTrainings`

**File: `src/lib/offline-storage.ts`** (3 functions, same pattern)

Replace the broken `IDBKeyRange.only(undefined)` approach with a single cursor scan that handles both never-synced and drift-unsynced records in one pass:

```typescript
// Instead of:
const neverSynced = await db.getAllFromIndex('inspections', 'by-synced', IDBKeyRange.only(undefined as any));
// ... separate drift cursor ...

// Use:
const db = await getDB();
const all = await db.getAll('inspections'); // full scan — simple & reliable
const unsynced = all.filter(record => {
  if (!record.synced_at) return true; // never synced
  if (record.updated_at) {
    const drift = new Date(record.updated_at).getTime() - new Date(record.synced_at).getTime();
    return drift > 2000;
  }
  return false;
});
```

This reverts to the original `getAll()` approach that was working before the broken "optimization." The Safari 5s timeout concern is theoretical — these stores typically contain <100 records.

Apply this fix to all three functions:
- `getUnsyncedInspections` (line 902)
- `getUnsyncedDailyAssessments` (line 1619)
- `getUnsyncedTrainings` (line 1952)

## Files Changed

| File | Change |
|------|--------|
| `src/lib/offline-storage.ts` | Fix 3 broken `getUnsynced*` functions — replace invalid `IDBKeyRange.only(undefined)` with reliable `getAll()` + filter |

## Expected Outcome

- Sync engine stops crashing → saves, completions, and invoice toggles work again
- Restored reports (like "Airiel Crawler World") are fully editable by their owner and admins
- No permission changes needed — the three-tier model already grants correct access

