

# Plan: Add "N/A" Option to Production Year Fields - v2.4.8

## Overview

Add an "N/A" quick-select button next to the existing numeric input for production year in the Equipment section. The numeric input remains fully functional. Selecting "N/A" stores a value of `0`, which the existing report generation already renders as "N/A" (since `0` is falsy and triggers the `|| "N/A"` fallback).

## Why `0` as the sentinel value

- The database column is `number | null` — cannot store string "N/A"
- No real equipment has a production year of `0`
- The existing HTML/PDF report code (`eq.production_year || "N/A"`) already treats `0` as "N/A" — zero changes needed to report generation
- Minimal schema adjustment needed (just widen the min bound)

## Technical Changes

### File 1: `src/components/inspection/EquipmentTable.tsx`

Replace the plain number input for production year with a combined input + "N/A" toggle button in both desktop table view and mobile card view.

**Desktop (table row, ~lines 160-169):**

Replace the bare `<Input type="number">` with a flex container holding the input and a small "N/A" button. When "N/A" is active (value === 0), the input is hidden and a badge/label shows "N/A" with a clear button.

**Mobile (card view, ~lines 249-258):**

Same combined control in the mobile layout.

**Behavior:**
- Clicking "N/A" sets `production_year` to `0` and triggers immediate save
- When value is `0`, the input shows "N/A" text with an "X" button to clear back to empty
- Clearing "N/A" sets the value back to `null` (empty input)
- Typing a year works exactly as before — any numeric input overrides the N/A state

### File 2: `src/lib/validation-schemas.ts`

Update the `production_year` validation to allow `0`:

Before: `z.number().int().min(1900).max(2100).optional().nullable()`
After: `z.number().int().refine(val => val === 0 || (val >= 1900 && val <= 2100), { message: "Must be a valid year or N/A" }).optional().nullable()`

### File 3: `vite.config.ts`

Bump version to **v2.4.8**.

## Files Changed

| File | Change |
|------|--------|
| `src/components/inspection/EquipmentTable.tsx` | Add N/A toggle button alongside production year input (desktop + mobile) |
| `src/lib/validation-schemas.ts` | Allow `0` as valid production_year value |
| `vite.config.ts` | Version bump to v2.4.8 |

## No Changes Needed

- **Report generation** (`generate-inspection-html`, `generate-inspection-pdf`): Already renders `0` as "N/A" via `eq.production_year || "N/A"`
- **Database schema**: `0` is a valid integer, no migration needed
- **Sync logic**: No changes — `0` syncs like any other number
- **InspectionForm.tsx**: No changes needed — equipment state management is untouched

## UI Behavior Summary

| State | Input shows | N/A button |
|-------|------------|------------|
| Empty (null) | Empty placeholder "Year" | Outlined "N/A" button |
| Year entered (e.g. 2019) | "2019" | Outlined "N/A" button |
| N/A selected (0) | "N/A" label with X clear | Filled/active "N/A" button |

