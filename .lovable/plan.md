

# Allow "+" Suffix in Equipment Quantity Field (e.g., "10+")

## Overview

Change the quantity field to accept values like `5+`, `10+`, `100+` in addition to plain numbers. This requires a database column type change from `integer` to `text`, plus updates to the input component, validation schema, and report generators.

## Changes Required

### 1. Database Migration
- Alter `inspection_equipment.quantity` from `integer` to `text`
- This preserves all existing numeric data (e.g., `10` becomes `'10'`)

```sql
ALTER TABLE public.inspection_equipment
  ALTER COLUMN quantity TYPE text
  USING quantity::text;
```

### 2. EquipmentTable.tsx (2 locations: desktop table + mobile card)
- Change input `type` from `"number"` to `"text"` with `inputMode="numeric"`
- Update validation to accept digits optionally followed by `+`
- Store the value as a string (e.g., `"10+"` or `"10"`)

### 3. Validation Schema (validation-schemas.ts)
- Change `quantity` from `z.number().int().positive()` to `z.string().regex(/^\d+\+?$/)` (digits with optional trailing +)

### 4. Report Generators (no logic changes needed)
- `generate-inspection-html` already renders `eq.quantity || "N/A"` -- works with strings
- `generate-inspection-pdf` already calls `eq.quantity?.toString() || 'N/A'` -- works with strings

## Technical Details

### EquipmentTable.tsx Input Change (applied to both desktop and mobile views)

**Before:**
```typescript
<Input
  type="number"
  min={1}
  value={item.quantity || ""}
  onChange={(e) => {
    const raw = e.target.value;
    if (raw === "") { updateEquipment(item, "quantity", null); return; }
    const val = parseInt(raw, 10);
    if (!isNaN(val) && val >= 1) {
      updateEquipment(item, "quantity", val);
    }
  }}
```

**After:**
```typescript
<Input
  type="text"
  inputMode="numeric"
  value={item.quantity || ""}
  onChange={(e) => {
    const raw = e.target.value;
    if (raw === "") { updateEquipment(item, "quantity", null); return; }
    if (/^\d+\+?$/.test(raw)) {
      updateEquipment(item, "quantity", raw);
    }
  }}
```

### Validation Schema Change

**Before:**
```typescript
quantity: z.number().int().positive().optional().nullable(),
```

**After:**
```typescript
quantity: z.string().regex(/^\d+\+?$/, "Must be a number, optionally followed by +").optional().nullable(),
```

## Files Changed

1. **Database migration** -- alter column type from integer to text
2. **src/components/inspection/EquipmentTable.tsx** -- update both desktop and mobile quantity inputs
3. **src/lib/validation-schemas.ts** -- update quantity validation rule
