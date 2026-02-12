

# Remove Brand Column from Rope Equipment & Update Type Dropdown

## Overview

Remove the `brand` column concept from Rope equipment records and convert the existing two-column layout (Brand + Type dropdown) into a single "Type" dropdown with four specific options. This change touches the UI form, database schema, and report generation (HTML and PDF).

## What Changes

The current Rope equipment row has two columns:
- **Brand** (free-text autocomplete via `equipment_type` field)
- **Type** (dropdown via `rope_type` field with 2 options)

After this change, Rope equipment will have one column:
- **Type** (dropdown with 4 options: Dynamic Kernmantle, Low-elongation Kernmantle, Static Kernmantle, Multi-Line)

The `equipment_type` column will store the selected dropdown value (replacing the free-text brand). The `rope_type` column becomes unused.

## Data Safety

All changes use **update/upsert** patterns only. No destructive delete operations. Existing records retain their data; the `rope_type` column is left in the database (not dropped) to avoid data loss for historical records.

## Files to Modify

| File | Change |
|------|--------|
| `src/components/inspection/EquipmentTable.tsx` | Replace Brand autocomplete + Type dropdown with single Type dropdown (4 options). Remove `showRopeType` prop. |
| `src/pages/InspectionForm.tsx` | Remove `showRopeType` prop from Rope EquipmentTable usage. |
| `supabase/functions/generate-inspection-html/index.ts` | Remove Brand/Type dual-column for rope; use single "Type" column showing `equipment_type`. |
| `supabase/functions/generate-inspection-pdf/index.ts` | Remove Brand/Type dual-column for rope; use single "Type" column like other categories. |

## Technical Details

### 1. EquipmentTable.tsx

- Remove the `showRopeType` prop entirely from the interface and component.
- For the Rope category, the first column ("Type") will render a `Select` dropdown instead of the `GlobalAutocomplete`. The dropdown options are:
  - `Dynamic Kernmantle`
  - `Low-elongation Kernmantle`
  - `Static Kernmantle`
  - `Multi-Line`
- The selected value is stored in `equipment_type` (not `rope_type`).
- Remove the conditional second "Type" column (`rope_type` dropdown).
- Need a new prop or detection mechanism: since `showRopeType` is being removed, the component needs to know when to show a dropdown vs. autocomplete. A new prop `useTypeDropdown` with the allowed values array, or simply a `ropeCategory` boolean, will be introduced. The simplest approach: add a `typeOptions` prop (optional string array). When provided, the Type column renders a dropdown with those options instead of the autocomplete.
- Remove the `rope_type` field from `addEquipment` initialization.
- Both desktop table and mobile card views are updated.

### 2. InspectionForm.tsx

- Remove `showRopeType` prop.
- Pass `typeOptions={["Dynamic Kernmantle", "Low-elongation Kernmantle", "Static Kernmantle", "Multi-Line"]}` to the Rope EquipmentTable.

### 3. generate-inspection-html/index.ts

- Remove the `category === "rope"` branch that renders `<th>Brand</th><th>Type</th>`.
- Rope now renders identically to other categories: single `<th>Type</th>` column with `eq.equipment_type`.

### 4. generate-inspection-pdf/index.ts

- Remove the `isRope` branching that adds a Brand column.
- Rope uses the same column layout as other equipment categories.
- Adjust `columnStyles` to use the non-rope layout for all categories.

