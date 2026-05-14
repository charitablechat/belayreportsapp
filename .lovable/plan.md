## Root cause (found in `src/pages/InspectionForm.tsx`)

Both bugs in the video have the same shape: an autosave that began before the user's interaction completes ends up **rewriting local state from a stale snapshot**, wiping the user's selection on the next render.

### 1. Equipment Type dropdown selections vanish

In the video the user adds a new harness row, picks "Headwall Seat Harness" from `EquipmentTypeCombobox`, and the cell snaps back to "Enter or select type" while existing rows below keep their values.

The combobox itself (`src/components/inspection/EquipmentTypeCombobox.tsx`) commits correctly via `onChange` → `updateEquipment(item, "equipment_type", value)`. The clobber happens here:

```ts
// src/pages/InspectionForm.tsx ~1981
const newEquipment = equipmentWithOrder
  .filter(e => !e.id || e.id.startsWith('temp-'))
  .map(e => ({ ...e, id: crypto.randomUUID(), inspection_id: id }));   // SNAPSHOT
...
// ~2112
queueMicrotask(() => {
  isInternalUpdateRef.current = true;
  setEquipment(prev => prev.map(e => {
    if (e.id?.startsWith('temp-') && equipmentTempToNewMap.has(e.id)) {
      return equipmentTempToNewMap.get(e.id)!;   // <-- replaces the WHOLE row with the stale snapshot
    }
    return e;
  }));
});
```

Sequence that reproduces the video:
```text
t0  user clicks "+ Add" (temp-id row, equipment_type="")
t1  autosave fires, takes snapshot of that row (equipment_type still "")
t2  user picks "Headwall Seat Harness" -> setEquipment updates row, equipment_type="Headwall Seat Harness"
t3  autosave's queued microtask runs -> setEquipment replaces the row with the t1 snapshot
    -> equipment_type back to "", row shows "Enter or select type"
```

Because only the `id` actually needed to change, the whole-row swap is what's destroying in-flight edits.

### 2. Operations Standards Yes/No checkboxes "toggle randomly"

`StandardsTable` already binds by index against the fixed `STANDARDS_TEMPLATE`, so the indexing is fine. The flicker comes from `onImmediateSave?.()` firing on every click, which triggers the same autosave path. While the equipment path has the explicit row-swap above, standards get re-hydrated indirectly when a refetch / `mergeStandards` runs against in-flight server data. The fix is to make the save path never overwrite a row the user has touched more recently than the snapshot.

## Plan

Single-file change: `src/pages/InspectionForm.tsx`.

1. **Preserve in-flight edits when adopting the new UUID for equipment** (~line 2112).
   Replace the whole-row swap with an id-only patch:
   ```ts
   setEquipment(prev => prev.map(e => {
     if (e.id?.startsWith('temp-') && equipmentTempToNewMap.has(e.id)) {
       const replacement = equipmentTempToNewMap.get(e.id)!;
       return { ...e, id: replacement.id, inspection_id: replacement.inspection_id };
     }
     return e;
   }));
   ```
   This keeps `equipment_type`, `production_year`, `quantity`, `result`, `comments`, `display_order`, and `is_divider` exactly as the user last typed them and only adopts the server-side UUID.

2. **Apply the same id-only-patch pattern to standards / systems / ziplines** wherever a post-save microtask replaces rows from a snapshot. Audit `setSystems`, `setZiplines`, `setStandards` near the save block and convert any "replace whole row from snapshot" into id-only patches.

3. **Guard against stale `mergeStandards` refresh** stomping on a click made during save: in the `setStandards(mergeStandards(standardsData))` branches (~1517, ~1523, ~1603), skip the merge if `isInternalUpdateRef.current` is true OR if a local row has a newer `updated_at` than the loaded one — same "local newer" guard the project already uses for the parent record.

4. **Leave `EquipmentTypeCombobox` and `StandardsTable` untouched.** Their state handling is already correct; this is purely a parent-state regression.

5. **Verification**:
   - `bunx tsc --noEmit`
   - Manual: add a new harness row, immediately pick a type from the dropdown before the "Saved" pill turns green — the value must remain.
   - Manual: rapid-toggle YES/NO on three different standards rows in under a second — every checkbox must end in the state the user last clicked.
   - Existing tests: `bunx vitest run src/components/__tests__/GlobalAutocomplete.dropdown-persistence.test.tsx` (regression lock unaffected).

### Out of scope
No business logic, schema, sync, or RLS changes. No edits to the combobox, the checkbox component, or any save/sync infrastructure beyond the row-merge shape.
