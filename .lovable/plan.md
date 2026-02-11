

# Rename "Kernmantle Rope" to "Rope" and Add Rope Type Column

## Overview

This change renames the equipment category from "Kernmantle Rope" to "Rope", renames the existing "Type" column to "Brand", and adds a new dropdown column "Type" with options "Kernmantle" and "Low Elongation (static)". A new database column is required to store the rope type selection.

## Database Change

A new nullable column `rope_type` will be added to the `inspection_equipment` table. This column only applies to equipment in the "rope" category.

```text
ALTER TABLE inspection_equipment ADD COLUMN rope_type text DEFAULT NULL;
```

## File Changes

### 1. Database Migration
- Add `rope_type text DEFAULT NULL` column to `inspection_equipment`

### 2. `src/pages/InspectionForm.tsx`
- Change `displayName="Kernmantle Rope"` to `displayName="Rope"` (line 2252)

### 3. `src/components/inspection/EquipmentTable.tsx`
- Accept a new optional prop `showRopeType?: boolean`
- **Desktop table (thead)**: Rename "Type" header to "Brand", insert new "Type" header between "Brand" and "Production Year"
- **Desktop table (tbody)**: Rename the existing `equipment_type` GlobalAutocomplete label context to "Brand", add a new `<td>` with a `<Select>` dropdown for `rope_type` with options: "Kernmantle", "Low Elongation (static)"
- **Mobile card view**: Same changes -- rename "Type" label to "Brand", add a "Type" dropdown field below it
- **`addEquipment` function**: Include `rope_type: null` in the default new item object

### 4. `supabase/functions/generate-inspection-html/index.ts`
- Change both instances of `"KERNMANTLE ROPE"` to `"ROPE"` (lines 2124, 2254)
- For the "rope" category only: rename "Type" column header to "Brand", add "Type" column header, and render `eq.rope_type || "N/A"` in the new column cell
- Non-rope categories remain unchanged (they keep "Type" as their first column)

### 5. `supabase/functions/generate-inspection-pdf/index.ts`
- Update the rope category title from "KERNMANTLE ROPE" to "ROPE"
- For the rope category: adjust the table headers to `['Brand', 'Type', 'Qty', 'Year', 'Result', 'Comments']` and include `eq.rope_type` in the body row

## Implementation Details

The rope type dropdown will use the existing Shadcn `Select` component:

```text
<Select value={item.rope_type || ""} onValueChange={(v) => updateEquipment(item, "rope_type", v)}>
  <SelectTrigger>
    <SelectValue placeholder="Select type" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="Kernmantle">Kernmantle</SelectItem>
    <SelectItem value="Low Elongation (static)">Low Elongation (static)</SelectItem>
  </SelectContent>
</Select>
```

The `showRopeType` prop will be passed as `true` only for the rope category from `InspectionForm.tsx`, keeping all other equipment categories completely unchanged.

## Scope

Only the rope equipment category is affected. No changes to harnesses, helmets, lanyards, connectors, belay devices, trolleys, or other equipment categories.

| File | Change |
|------|--------|
| Database migration | Add `rope_type` column |
| `src/pages/InspectionForm.tsx` | Rename displayName to "Rope" |
| `src/components/inspection/EquipmentTable.tsx` | Rename Type to Brand, add Type dropdown column (conditional on `showRopeType` prop) |
| `supabase/functions/generate-inspection-html/index.ts` | Update title and table columns for rope category |
| `supabase/functions/generate-inspection-pdf/index.ts` | Update title and table columns for rope category |
