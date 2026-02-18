

# Production Year: Support Date Ranges (e.g., "2019-2021")

**Version bump: v2.5.9 → v2.6.0**

## Problem
The `production_year` column in `inspection_equipment` is an `integer`, which only allows single year values like `2023`. Users need to enter date ranges like `2019-2021` for equipment that spans multiple production years.

## Approach
Migrate `production_year` from `integer` to `text`, following the same pattern used for the `quantity` field (which was previously migrated from integer to text to support "10+" values).

## Changes

### 1. Database Migration
Alter the `inspection_equipment` table to change `production_year` from `integer` to `text`. Existing integer values (e.g., `2023`) will be automatically cast to text (`"2023"`). The sentinel value `0` for N/A becomes `"0"`.

```sql
ALTER TABLE inspection_equipment
  ALTER COLUMN production_year TYPE text
  USING production_year::text;
```

### 2. Validation Schema (`src/lib/validation-schemas.ts`)
Update the `equipmentSchema` to validate `production_year` as a string matching either:
- A single year: `2023`
- A year range: `2019-2021`
- The N/A sentinel: `0`

New regex pattern: `/^(0|\d{4}(-\d{4})?)$/`

### 3. Equipment Table UI (`src/components/inspection/EquipmentTable.tsx`)
**Desktop view (lines 210-241) and Mobile view (lines 378-409):**
- Change `inputMode` from `"numeric"` to `"text"` to allow the hyphen character
- Update `onChange` regex from `/^\d{0,4}$/` to `/^\d{0,4}(-\d{0,4})?$/` to accept partial range input
- Update `onBlur` validation: instead of checking numeric bounds, validate completed input matches the full year/range pattern
- Store as string instead of `parseInt()`
- N/A sentinel comparison changes from `=== 0` to `=== "0"` (string)
- N/A button sets value to `"0"` (string) instead of `0` (number)

### 4. New Equipment Default (`addEquipment` callback, line 84)
Change `production_year: null` — no change needed, null remains valid.

### 5. HTML Report (`supabase/functions/generate-inspection-html/index.ts`)
Lines 2159 and 2289: The existing `${eq.production_year || "N/A"}` logic works correctly for text values. The sentinel `"0"` is falsy in JS so it renders as "N/A" — **wait, "0" is truthy as a string**. Need to add explicit check:
```
${eq.production_year === "0" ? "N/A" : eq.production_year || "N/A"}
```

### 6. PDF Report (`supabase/functions/generate-inspection-pdf/index.ts`)
Line 425: Same fix needed:
```
eq.production_year === "0" ? "N/A" : eq.production_year?.toString() || 'N/A'
```

### 7. Version Bump (`vite.config.ts`)
- `APP_VERSION`: `"2.5.9"` → `"2.6.0"`
- `BUILD_TIMESTAMP`: updated to current date/time

## What Does NOT Change
- All data protection and backup systems remain untouched
- The N/A button behavior stays the same (just uses string `"0"` instead of integer `0`)
- Photo handling, sync logic, WAL backups — all unaffected
- All other form types (training, daily assessment) — unaffected

## Technical Details

| File | Change |
|------|--------|
| Database migration | `ALTER COLUMN production_year TYPE text` |
| `src/lib/validation-schemas.ts` | Regex validation for year or year-range string |
| `src/components/inspection/EquipmentTable.tsx` | Text input, string comparisons, range-aware regex |
| `supabase/functions/generate-inspection-html/index.ts` | `"0"` sentinel check for N/A display |
| `supabase/functions/generate-inspection-pdf/index.ts` | `"0"` sentinel check for N/A display |
| `vite.config.ts` | Version bump to v2.6.0 |

