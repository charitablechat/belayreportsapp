## Root cause: stale-closure clobber in `StandardsTable.updateStandard`

The previous fix (`mergeStandardsPreserveLocal`) closed the realtime/refetch race, but there is a second, more direct cause for "checkboxes toggle randomly" that lives entirely in the component itself.

`src/components/inspection/StandardsTable.tsx`:

```ts
export default function StandardsTable({ standards, onUpdate, onImmediateSave }) {
  const updateStandard = (index, has_documentation) => {
    const updated = [...standards];                 // <-- closure over the *prop* `standards`
    ...
    updated[index] = { ...existing, has_documentation };
    onUpdate(updated);
    onImmediateSave?.();
  };
}
```

Every checkbox click clones the `standards` snapshot from the render that was active when its handler was created. React batches state updates inside a single event tick, but it does NOT re-render between two synchronous handler invocations. So when a user taps two checkboxes in quick succession (or the same checkbox twice), both handlers see the *same* stale `standards` array and the second `onUpdate` overwrites the first.

Reproduction matching the user's report:
```text
t0  render with standards = [null,null,null,null,null,null]
t1  user clicks row 0 YES   -> updated=[true,null,null,...]   -> onUpdate(updated)
t2  React schedules re-render but hasn't flushed
t3  user clicks row 1 YES   -> reads SAME prop snapshot
                              -> updated=[null, true, null,...] (row 0 LOST)
                              -> onUpdate(updated)
t4  re-render -> row 0 appears unchecked again ("random toggle")
```

The same race happens when `onImmediateSave?.()` triggers a microtask that re-renders the parent before a queued state update has flushed.

`EquipmentTable` already avoids this by using the functional updater form (`onUpdate(prev => prev.map(...))`). `StandardsTable` does not.

## Plan

Single-file change: `src/components/inspection/StandardsTable.tsx`.

1. Widen `onUpdate` prop type to accept either an array or an updater function:
   ```ts
   onUpdate: (next: any[] | ((prev: any[]) => any[])) => void;
   ```
   This matches the `EquipmentTable` signature and `setStandards` (React `Dispatch<SetStateAction<…>>`) already accepts both shapes — parent call sites need no change.

2. Rewrite `updateStandard` to use the functional form so each click reads the latest committed array, eliminating the stale-closure clobber:
   ```ts
   const updateStandard = (index, has_documentation) => {
     triggerHaptic('light');
     const inspectionId = window.location.pathname.split('/').pop();
     onUpdate(prev => {
       const updated = [...prev];
       const existing = updated[index] || {};
       updated[index] = {
         ...existing,
         id: existing.id || crypto.randomUUID(),
         inspection_id: inspectionId,
         standard_name: STANDARDS_LIST[index].name,
         has_documentation,
       };
       return updated;
     });
     onImmediateSave?.();
   };
   ```

3. Coalesce burst `onImmediateSave` calls so rapid consecutive clicks do not fire overlapping saves that can race with each other (each save re-snapshots state; overlapping saves can re-introduce the same clobber). Use a microtask gate:
   ```ts
   const saveScheduledRef = useRef(false);
   const scheduleSave = () => {
     if (saveScheduledRef.current) return;
     saveScheduledRef.current = true;
     queueMicrotask(() => {
       saveScheduledRef.current = false;
       onImmediateSave?.();
     });
   };
   ```
   Replace the direct `onImmediateSave?.()` call inside `updateStandard` with `scheduleSave()`. This guarantees that a burst of clicks resolves into a single save after React has flushed the batched state update — the save will see all clicks, not a partial snapshot.

4. Leave the existing `mergeStandardsPreserveLocal` guard from the previous fix in place (covers the cross-device realtime path).

5. No changes to: parent `InspectionForm` save logic, the `inspection_standards` schema, the `STANDARDS_TEMPLATE`, the checkbox UI, or any backend/edge function.

## Verification

- `bunx tsc --noEmit` — type signature change is compatible because `setStandards` already accepts updater form.
- Manual: rapid-tap YES on rows 1, 2, 3 in under 500 ms — all three must remain checked.
- Manual: tap YES on a row, then immediately tap NO on the same row — the row must end in NO state, not flicker back to YES.
- Existing tests: `bunx vitest run` — no behavioral change to passing snapshots / regression locks.

### Out of scope
- The `EquipmentTypeCombobox` row-replace fix from the previous turn already shipped; not revisiting.
- No schema, RLS, sync engine, or edge-function changes.
