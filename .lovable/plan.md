

# Fix Rope Type Values Not Displaying (Data Migration Required)

## Root Cause

The data is **not lost**. It is safely stored in the database. The issue is a **value mismatch** between existing data and the new dropdown options introduced in the recent refactor.

The old dropdown had values like:
- `Dynamic`
- `Low Elongation (static)`
- `Low Elongation`
- `blue water`

The new dropdown expects:
- `Dynamic Kernmantle`
- `Low-elongation Kernmantle`
- `Static Kernmantle`
- `Multi-Line`

Since `"Dynamic"` does not match `"Dynamic Kernmantle"`, the Select component renders blank, making it appear as though data was erased.

## Solution

### Step 1: Database Migration -- Map Old Values to New Values

Run a safe UPDATE migration to remap existing rope `equipment_type` values:

| Old Value | New Value |
|-----------|-----------|
| `Dynamic` | `Dynamic Kernmantle` |
| `Low Elongation (static)` | `Static Kernmantle` |
| `Low Elongation` | `Low-elongation Kernmantle` |
| `blue water` | *(leave unchanged -- see note)* |

`blue water` appears to be a brand name, not a rope type. It will be left as-is; the user can manually correct it in the form.

### Step 2: UI Resilience -- Handle Unrecognized Values Gracefully

Modify `EquipmentTable.tsx` so that when a `typeOptions` dropdown is used but the current `equipment_type` value does not match any option, the component:
1. Still displays the stored value (not blank)
2. Shows it with a visual indicator (e.g., warning styling) so the user knows it needs updating
3. Allows selecting a valid option to replace it

This prevents any future dropdown option rename from silently blanking out existing data.

### Step 3: Quantity Protection (No Change Needed)

Quantities are intact in the database. The visual "loss" was caused by the same blank-row appearance from the type mismatch. Once types display correctly, quantities will also be visible as normal.

## Files to Modify

| File | Change |
|------|--------|
| New SQL migration | UPDATE `inspection_equipment` to remap old rope type values to new values |
| `src/components/inspection/EquipmentTable.tsx` | Add fallback display for unrecognized `equipment_type` values when `typeOptions` is provided |

## Technical Details

### SQL Migration

```sql
UPDATE inspection_equipment
SET equipment_type = CASE equipment_type
  WHEN 'Dynamic' THEN 'Dynamic Kernmantle'
  WHEN 'Low Elongation (static)' THEN 'Static Kernmantle'
  WHEN 'Low Elongation' THEN 'Low-elongation Kernmantle'
  ELSE equipment_type
END
WHERE equipment_category = 'rope'
  AND equipment_type IN ('Dynamic', 'Low Elongation (static)', 'Low Elongation');
```

This is a safe UPDATE (no deletes), fully aligned with the Zero Data Loss strategy.

### EquipmentTable.tsx -- Unrecognized Value Fallback

When `typeOptions` is provided and the current `equipment_type` value is not in the options list:
- Temporarily include the current value as an extra option in the dropdown (marked with a note like "(legacy)")
- This ensures the value is visible and the user can choose to update it to a valid option

This approach prevents future dropdown option changes from ever causing a "blank field" appearance.

