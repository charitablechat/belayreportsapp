

## Problem
User adds 3 empty harness rows, types in row 1 → row 1 jumps to the bottom. Same happens for rows 2 and 3. Caused by sort order: empty rows likely sort before filled rows (or filled rows resort by `equipment_type` alphabetically / by `updated_at`), so the moment a row gets a value it gets reordered.

## Investigation needed
Read these to confirm the exact sort logic:
- `src/components/inspection/EquipmentTable.tsx` — how rows are rendered/sorted
- `src/pages/InspectionForm.tsx` — `equipment` state, add handler, and any sort applied before rendering
- Possibly `src/lib/report-utils.ts` for sort helpers

Most likely culprit: rows sorted by `display_order` where new rows get `display_order = items.length` at add time, but a stale/missing `display_order` on the just-typed row triggers a reorder. Or rows sorted by `equipment_type` / `updated_at desc` causing typed rows to fall to the end.

## Fix
Ensure equipment rows render in **stable insertion order**:
1. When `addEquipment` runs, assign `display_order = max(existing) + 1` (or `Date.now()` index) immediately so all 3 new rows have distinct, ascending values.
2. Render strictly by `display_order` ascending (then `created_at` as tiebreaker). Do NOT re-sort on `equipment_type`, `updated_at`, or "empty rows last".
3. Never mutate `display_order` on type/edit — only on explicit drag-reorder.

This matches the existing memory `mem://features/reports/item-ordering-integrity` (deterministic ordering via `display_order` or `created_at`).

## Files to modify
- `src/pages/InspectionForm.tsx` — fix `addEquipment` to stamp incrementing `display_order`; ensure no sort-on-update
- `src/components/inspection/EquipmentTable.tsx` — verify sort uses `display_order` ascending only
- Same pattern likely needed for `OperatingSystemsTable` and `ZiplinesTable` (apply if same bug exists)

