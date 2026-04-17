

User wants to ensure no Pass/Fail result fields default to "Pass" anywhere in the app. From earlier liability discussion — defaulting to Pass is a major liability risk (a skipped item silently becomes a "Pass" record).

Let me audit where result fields are initialized.

Known result-bearing entities from validation schemas:
- `systems` — `result` enum, optional/nullable ✅ schema allows unset
- `ziplines` — `result` REQUIRED enum, plus `cable_result`, `braking_result`, `ead_result` (optional)
- `equipment` — `result` REQUIRED enum
- `standards` — `has_documentation` boolean nullable (already handled — null = "Not Set")

ResultSelect component supports any string value including "" (placeholder shows "Select result"). Good.

Need to check actual defaults at row creation in:
- `src/components/inspection/OperatingSystemsTable.tsx` (systems)
- `src/components/inspection/ZiplinesTable.tsx`
- `src/components/inspection/EquipmentTable.tsx`
- `src/pages/InspectionForm.tsx` (any default rows seeded on new inspection)
- `supabase/functions/parse-inspection-docx` (DOCX import — does it default to "pass"?)

Also need to check:
- DB column defaults on `systems.result`, `ziplines.result`, `equipment.result`
- Validation schemas require `result` for ziplines/equipment — if we change default to unset, completion may fail. But per memory `report-completion-validation-bypass`, completion is non-blocking, so safe.

Plan, after approval:

## Audit (read these files)
1. `OperatingSystemsTable.tsx`, `ZiplinesTable.tsx`, `EquipmentTable.tsx` — find `addRow`/`addNew` handlers, check default `result` value
2. `InspectionForm.tsx` — check any seeded default rows
3. `parse-inspection-docx/index.ts` — check imported row defaults
4. Run `supabase--read_query` to inspect column defaults on `systems`, `ziplines`, `equipment` tables
5. Loosen `ziplineSchema.result` / `equipmentSchema.result` to `.optional().nullable()` to match systems

## Fixes
1. **New rows**: change any `result: 'pass'` default to `result: null` (or empty string `''`) so the dropdown shows "Select result" placeholder
2. **DB defaults**: if `result` columns have a `DEFAULT 'pass'`, drop it via migration so server-side inserts don't backfill Pass
3. **Validation schemas**: make `ziplines.result` and `equipment.result` nullable so unset items don't fail validation
4. **DOCX import**: if parser defaults to "pass" for unspecified items, change to null and surface a warning
5. **Completion-time check (already discussed in earlier liability plan #5)**: at report completion, count items with unset `result` and show a non-blocking warning toast: "N items have no result set — they will appear as 'Not Set' on the report."
6. **Report rendering**: ensure HTML/PDF generation displays "Not Set" (not blank or "Pass") for null results, with a visible amber/grey badge — verify in `_shared/report-layout.ts` and the three generate-*-html functions

## Files likely touched
- `src/components/inspection/OperatingSystemsTable.tsx`
- `src/components/inspection/ZiplinesTable.tsx`
- `src/components/inspection/EquipmentTable.tsx`
- `src/lib/validation-schemas.ts` (loosen required result enums)
- `src/pages/InspectionForm.tsx` (completion-time warning)
- `supabase/functions/parse-inspection-docx/index.ts` (if it defaults to pass)
- `supabase/functions/_shared/report-layout.ts` + `generate-inspection-html/index.ts` (render "Not Set")
- Migration: drop any `DEFAULT 'pass'` on `systems.result`, `ziplines.result`, `equipment.result`

## Out of scope
- Daily Assessment & Training don't have Pass/Fail results (they use checkboxes / approach selectors) — no changes needed there
- `standards.has_documentation` already supports null = "Not Set" per memory

Approve and I'll execute the audit + fixes in one pass.

