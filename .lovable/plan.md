

# Data Persistence Strategy: Audit and Hardening Plan

## Current State Assessment

Your application already implements a mature, offline-first data persistence architecture. This audit confirms that the core design is sound and identifies a small number of targeted improvements to close remaining edge-case gaps.

### What Already Works Well

- **IndexedDB as primary local store** with circuit breaker pattern (3 failures triggers 60s cooldown)
- **Atomic sync manager** with deferred `synced_at` stamping, rollback support, and soft-delete detection via RLS-bypassing RPC
- **Non-blocking saves** with 8s timeout protection and fire-and-forget local persistence
- **Auto-sync** with debounced triggers, visibility-change sync, online-reconnect sync, periodic polling, and realtime subscriptions
- **Batch processing** (max 5 items per cycle) with accelerated re-sync for draining queues
- **Session validation** before every sync cycle with 60s refresh buffer
- **Local-first data guard** (`localIsNewer`) comparing `updated_at` timestamps to prevent server overwrites
- **Dashboard orphan cleanup** only after confirmed successful network fetch

---

## Identified Gaps and Proposed Fixes

### Gap 1: `handleHeaderUpdate` lacks offline queue on save failure

**File**: `src/pages/InspectionForm.tsx` (lines 598-636)

**Issue**: When `handleHeaderUpdate` saves to IndexedDB and then the Supabase update fails (network error, timeout), the error is caught and logged but the operation is **not queued** for later sync. The `catch` block on line 633 only logs the error. Contrast this with the `else` branch (offline path) which correctly calls `queueOperation`.

**Fix**: In the `catch` block, add `queueOperation('update', id!, updatedInspection)` so failed online saves are automatically retried.

### Gap 2: Auto-save's fire-and-forget pattern silently drops IndexedDB failures

**File**: `src/pages/InspectionForm.tsx` (lines 1074-1088)

**Issue**: The main `handleSaveProgress` save path uses `Promise.all([...]).catch(warn)` for offline storage. If IndexedDB fails (quota exceeded, circuit breaker open), the user has no indication that their local backup was not persisted. The server sync may also fail later, leaving zero copies of the data.

**Fix**: Track a `localSaveFailed` flag. If the local save fails AND the subsequent server sync also fails, show a persistent warning toast: "Save could not be completed. Please check your connection and try again." This ensures at least one copy of the data is confirmed before the user navigates away.

### Gap 3: `onImmediateSave` type signature mismatch risk

**File**: `src/components/inspection/EquipmentTable.tsx`

**Issue**: The recently fixed functional updater pattern (`onUpdate(prev => ...)`) requires the parent to pass a state setter that accepts `(prev => newValue)`. If any parent passes a plain callback (`(newArray) => doSomething(newArray)`), the functional updater will silently receive the wrong argument. The `EquipmentTableProps` type was updated, but the parent form's `setEquipment` should be verified to be the direct React state setter.

**Fix**: Verify in `InspectionForm.tsx` that every `<EquipmentTable onUpdate={setEquipment} />` call passes `setEquipment` directly (not a wrapper function). If a wrapper is used, it must handle the functional updater form.

### Gap 4: No save confirmation before navigation on stale closure recovery

**Issue**: If a user enters data, the stale closure bug (now fixed) previously caused data loss. However, the `useUnsavedChanges` hook relies on the `hasUnsavedChanges` flag. If the flag is reset prematurely (e.g., after a partial save), the navigation guard won't fire.

**Fix**: Ensure `setHasUnsavedChanges(false)` is only called after both local AND remote saves succeed (or at minimum after local save succeeds). Currently, `handleHeaderUpdate` sets it to `false` on line 632 before confirming the server save succeeded.

---

## Architecture Summary (No Changes Needed)

These components require no modifications -- they are confirmed robust:

| Component | Status |
|---|---|
| IndexedDB schema (22 object stores) | Confirmed |
| Circuit breaker (3 failures, 60s cooldown) | Confirmed |
| `withIndexedDBErrorBoundary` (5s timeout) | Confirmed |
| Atomic sync with deferred `synced_at` | Confirmed |
| Transaction manager with rollback | Confirmed |
| `ensureValidSession` with 60s refresh buffer | Confirmed |
| Batch sync (max 5, accelerated re-sync) | Confirmed |
| Dashboard orphan cleanup (server-confirmed only) | Confirmed |
| Soft-delete detection via `check_record_status` RPC | Confirmed |
| `localIsNewer` guard for all 3 report types | Confirmed |

---

## Implementation Priority

1. **Gap 1** (Header update queue on failure) -- Highest priority, simplest fix, prevents silent data loss on flaky connections
2. **Gap 4** (Premature unsaved-changes reset) -- High priority, prevents false navigation-safe signal
3. **Gap 2** (Double-failure warning) -- Medium priority, edge case but important for user awareness
4. **Gap 3** (Type verification) -- Low priority, likely already correct but worth confirming

## Technical Details

### Gap 1 Fix (1 file change)
In `src/pages/InspectionForm.tsx`, `handleHeaderUpdate` catch block (~line 633):
```typescript
} catch (error: any) {
  console.error("Error updating field:", error);
  // Queue for retry so the change isn't lost
  if (id) {
    queueOperation('update', id, updatedInspection).catch(() => {});
  }
}
```

### Gap 4 Fix (1 file change)
In `src/pages/InspectionForm.tsx`, `handleHeaderUpdate` (~line 632):
Move `setHasUnsavedChanges(false)` inside the success path of the server update (after line 622), and also set it after the offline queue succeeds (after line 625). Remove it from outside the if/else block.

### Gap 2 Fix (1 file change)
In `src/pages/InspectionForm.tsx`, `handleSaveProgress`, track local save result:
```typescript
let localSaveSucceeded = false;
Promise.all([...]).then(() => { localSaveSucceeded = true; }).catch(...);
// Later, if server sync also fails:
if (!localSaveSucceeded) {
  toast({ title: "Warning", description: "Data could not be saved locally or remotely.", variant: "destructive" });
}
```

### Gap 3 Fix (verification only)
Confirm that all 8 `<EquipmentTable>` instances in `InspectionForm.tsx` pass `setEquipment` directly as the `onUpdate` prop, not a wrapper function.

