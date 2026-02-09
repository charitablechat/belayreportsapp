

# Fix Data Quality: Production Year & Quantity Validation

## Overview

Add UI-level input validation to prevent invalid production years and negative quantities, plus a one-time SQL migration to correct 4 corrupted records already in the database.

---

## 1. UI Validation -- Production Year (EquipmentTable.tsx)

Replace the raw `parseInt` handler on all 4 production_year inputs (2 desktop, 2 mobile) with a validating handler that:
- Allows empty input (clears to `null`)
- Rejects values outside the 1900--2100 range
- Clamps `maxLength` to 4 digits via `min`/`max` HTML attributes as a first defense

**Current code (4 locations -- lines 177, 293 for onChange; lines 175, 291 for the Input):**
```typescript
onChange={(e) => updateEquipment(item, "production_year", parseInt(e.target.value) || null)}
```

**New code:**
```typescript
onChange={(e) => {
  const raw = e.target.value;
  if (raw === "") { updateEquipment(item, "production_year", null); return; }
  const val = parseInt(raw, 10);
  if (!isNaN(val) && val >= 1900 && val <= 2100) {
    updateEquipment(item, "production_year", val);
  }
}}
```

Also add `min={1900} max={2100}` attributes to the `<Input>` elements as browser-level guardrails.

---

## 2. UI Validation -- Quantity (EquipmentTable.tsx)

Replace the raw `parseInt` handler on all 2 quantity inputs (1 desktop line 199, 1 mobile line 317) with:

**Current:**
```typescript
onChange={(e) => updateEquipment(item, "quantity", parseInt(e.target.value) || null)}
```

**New:**
```typescript
onChange={(e) => {
  const raw = e.target.value;
  if (raw === "") { updateEquipment(item, "quantity", null); return; }
  const val = parseInt(raw, 10);
  if (!isNaN(val) && val >= 1) {
    updateEquipment(item, "quantity", val);
  }
}}
```

Also add `min={1}` to the `<Input>` elements.

---

## 3. One-Time SQL Migration

Correct the 4 known corrupted records:

```sql
-- Fix production_year values that were entered as MMDDYYYY instead of YYYY
UPDATE public.inspection_equipment
SET production_year = 2024
WHERE id IN (
  '75835ff6-a8b0-4765-a76e-7f4ee22c26b1',
  '7bdb315f-13e2-4f6e-8dba-4f67d7fbeaaa',
  '9d9da640-a1b3-4808-8d2a-7a5b51df53e9'
)
AND production_year NOT BETWEEN 1900 AND 2100;

-- Fix negative quantity
UPDATE public.inspection_equipment
SET quantity = 1
WHERE id = '1cac4962-37b5-4b7d-a65d-ced6fc72da58'
AND quantity < 1;
```

---

## 4. Zod Schema Update (validation-schemas.ts)

The existing Zod schema already validates `production_year` with a range check, but `quantity` only checks `.positive()`. No changes needed -- both schemas already reject invalid values at the sync/validation layer. The UI fix prevents bad data from reaching the schema in the first place.

---

## Files Changed

| File | Change |
|------|--------|
| `src/components/inspection/EquipmentTable.tsx` | Add range validation to 4 production_year inputs and 2 quantity inputs; add `min`/`max` HTML attributes |
| SQL migration | One-time fix for 4 corrupted records |

## What This Does NOT Change

- No changes to save logic, auto-save timing, or `isInternalUpdateRef`
- No changes to other components (Systems, Ziplines, Standards)
- No changes to the Zod validation schema (already correct)
- No new dependencies

