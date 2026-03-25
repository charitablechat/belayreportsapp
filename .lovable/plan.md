

## Fix: Equipment Not Showing After Import

### Root Cause

Two issues are causing equipment to silently fail insertion:

1. **Silent error swallowing**: Every child insert uses `.then()` which converts the Supabase response (including errors) into `undefined`. `Promise.allSettled` then sees all promises as "fulfilled" — even when the DB returns an error. No errors are ever logged.

2. **Required columns with null values**: The `inspection_equipment` table requires `equipment_type` and `equipment_category` to be non-null strings. The AI sometimes returns `null` or `undefined` for these fields. Unlike `inspection_systems` (where `name` and `system_name` are nullable), this causes the entire batch insert to fail.

### Changes

**File: `src/pages/NewInspection.tsx`**

1. **Fix error handling for all child inserts** — replace `.then()` with a proper error-checking pattern that throws on Supabase errors so `Promise.allSettled` can catch them:
   ```typescript
   // Before (swallows errors):
   promises.push(supabase.from("inspection_equipment").insert(rows).then());
   
   // After (surfaces errors):
   promises.push(
     supabase.from("inspection_equipment").insert(rows)
       .then(({ error }) => { if (error) throw error; })
   );
   ```

2. **Default required equipment fields** — ensure `equipment_type` and `equipment_category` always have a non-empty string value:
   ```typescript
   equipment_type: e.equipment_type || "Unknown",
   equipment_category: e.equipment_category || "General",
   ```

3. **Log successful insert counts** — add a console log showing how many rows were inserted per section for debugging.

Apply the same `.then()` fix to all five insert calls (systems, equipment, ziplines, standards, summary).

### Files

| File | Change |
|------|--------|
| `src/pages/NewInspection.tsx` | Fix error handling on all 5 insert calls; default required equipment fields to non-empty strings |

