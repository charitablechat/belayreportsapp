

## Rename "Production Year" to "Manufacture Year(s)"

Four files need updating:

### 1. `src/components/inspection/EquipmentTable.tsx`
- Line 326: `"Production Year"` → `"Manufacture Year(s)"`
- Line 500: `"Production Year"` label → `"Manufacture Year(s)"`

### 2. `supabase/functions/generate-inspection-html/index.ts`
- Line 2195: `<th>Year</th>` → `<th>Manufacture Year(s)</th>`
- Line 2325: `<th>Year</th>` → `<th>Manufacture Year(s)</th>`

### 3. `supabase/functions/generate-inspection-pdf/index.ts`
- Line 435: Header array `'Year'` → `'Mfg Year(s)'` (abbreviated for PDF column width)

### Retroactivity
Reports are generated on-demand, so all existing and future reports will use the new label automatically.

No database changes needed -- the column name `production_year` stays as-is in the schema; only display labels change.

