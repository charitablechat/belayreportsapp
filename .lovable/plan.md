

# Fix Equipment Type Dropdown: Show Options for Existing Values

## Problem
Two issues visible in the video:
1. **Dropdown shows filtered/empty list when clicking an already-filled field** — `handleTriggerFocus` sets `searchValue` to the current value (e.g., "Headwall Chest Sling"), which filters the options list down to just that one match or nothing if the value isn't in the options table yet.
2. **Custom values don't persist in dropdown** — If a custom value was entered but the `addOption` mutation didn't complete (offline, race condition, etc.), that value won't appear in the dropdown on subsequent opens.

## Fix

### 1. EquipmentTypeCombobox.tsx — Show all options on open
- Change `handleTriggerFocus` to set `searchValue` to `""` instead of `value`. This ensures ALL dropdown options display when the user clicks on a field that already has a value, letting them browse and change their selection.
- The input still displays the current value via `isEditing ? searchValue : value`, so the user sees their existing value but the dropdown shows everything.

### 2. useEquipmentTypeOptions.ts — Merge current equipment values into options
- Accept an optional `existingValues: string[]` parameter (the equipment_type values from current report items in this category).
- After fetching options from DB/cache, merge any `existingValues` that aren't already in the list — this guarantees custom-entered values always appear in the dropdown even if they were never synced to `equipment_type_options`.
- Also auto-add missing values to IndexedDB cache so they persist offline.

### 3. InspectionForm.tsx — Pass existing equipment values
- For each category's `useEquipmentTypeOptions` call, compute the unique `equipment_type` values from current equipment items in that category.
- Pass them as `existingValues` so they're merged into the options list.

## Files Modified
- `src/components/inspection/EquipmentTypeCombobox.tsx` — one line change in `handleTriggerFocus`
- `src/hooks/useEquipmentTypeOptions.ts` — add `existingValues` param + merge logic
- `src/pages/InspectionForm.tsx` — pass existing values per category

