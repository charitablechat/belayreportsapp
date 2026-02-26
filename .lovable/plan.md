

## Root Cause: IndexedDB Timeout Fallbacks Erased Real Data

### What Happened

The Marine Military Academy data loss followed this sequence:

1. User edited the report for ~1.5 hours. Child data (systems, ziplines, equipment) was saved to IndexedDB successfully.
2. The Service Worker performed a "false-success" sync -- parent shell synced but child data did not reach the server. `synced_at` was stamped on the parent.
3. Post-sync, `updated_at` was aligned to match `synced_at` in IndexedDB, making the record appear "fully synced."
4. On next form open (online), `isLocalDataNewer()` returned `false` (timestamps aligned), so the code took the "server data is current" path.
5. The non-regression guards correctly prevented empty server arrays from overwriting React state.
6. **However**, the initial `getRelatedDataOffline` calls (lines 900-912) likely **timed out** (the console logs show frequent "Operation timed out after 5000ms" errors). When they timeout, the `withOfflineTimeout` wrapper returns **empty arrays** as fallback values.
7. React state initialized with these empty arrays. The auto-save debounce (1.5s) then fired and **wrote the empty arrays back to IndexedDB**, permanently erasing the real child data.
8. The localStorage backup ledger shows 9am as the last save because that was the last **successful** IndexedDB write before timeouts began. The 11:30pm activity was likely hitting timeout fallbacks.

### The Core Bug

`withIndexedDBErrorBoundary` returns `[]` (empty array) on timeout, and this is **indistinguishable** from "the user intentionally has zero items." When auto-save fires, it persists whatever is in React state -- including timeout-sourced empty arrays -- back to IndexedDB, destroying real data.

### Fix: Track Timeout-Sourced Data to Prevent Destructive Auto-Save

**1. Add a "data loaded successfully" flag per child type** -- `src/pages/InspectionForm.tsx`

Add a ref that tracks whether each child data type was loaded from a real IndexedDB read (not a timeout fallback). The auto-save function checks this flag before writing child data.

```typescript
// New ref to track which child types loaded successfully from IndexedDB
const childDataLoadedRef = useRef<Record<string, boolean>>({
  systems: false,
  ziplines: false,
  equipment: false,
  standards: false,
  summary: false,
});
```

After each successful `getRelatedDataOffline` call, mark the corresponding flag as `true`. On timeout (empty fallback), the flag stays `false`.

**2. Guard the auto-save write path** -- `src/pages/InspectionForm.tsx`

In the `performSave` function, skip writing child data for any type where `childDataLoadedRef.current[type] === false` AND the React state array is empty. This prevents timeout-sourced empty arrays from overwriting real data in IndexedDB.

```typescript
// In performSave, before each saveRelatedDataOffline call:
if (systems.length > 0 || childDataLoadedRef.current.systems) {
  await saveRelatedDataOffline('systems', id!, systems);
}
// Same pattern for ziplines, equipment, standards, summary
```

Logic: If the array has items, always save (user has data). If the array is empty AND it was loaded successfully, save (user intentionally cleared). If the array is empty AND it was NOT loaded successfully (timeout), skip (preserve existing IndexedDB data).

**3. Apply the same pattern to Training and Daily Assessment forms**

The same timeout-to-empty-array-to-auto-save chain exists in `TrainingForm.tsx` and `DailyAssessmentForm.tsx`. Apply the identical `childDataLoadedRef` pattern.

**4. Mark server-sourced data as "loaded" too** -- `src/pages/InspectionForm.tsx`

When server data arrives and is applied (the `else` branch at line 1077), also mark the corresponding child types as loaded so that subsequent saves can write them.

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Add `childDataLoadedRef`, set flags on successful loads, guard auto-save writes |
| `src/pages/TrainingForm.tsx` | Same pattern for training child data types |
| `src/pages/DailyAssessmentForm.tsx` | Same pattern for daily assessment child data types |

### What This Does NOT Change

- No changes to IndexedDB, sync logic, or service worker
- No changes to the localStorage backup ledger
- No DELETE or clear operations added
- Existing data is never touched -- this only prevents future empty-array overwrites
- The `withIndexedDBErrorBoundary` timeout behavior stays the same (it still returns fallbacks for UI responsiveness)

### Why the Existing Guards Were Not Enough

The non-regression guards (lines 1097-1159) only protect against **server** empty arrays overwriting local state. They do NOT protect against **local** timeout-sourced empty arrays being auto-saved back to IndexedDB. This fix closes that gap.

