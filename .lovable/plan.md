## Problem

The fix I just deployed isn't taking effect because the exemption rule is too broad. Each `.page` wrapper contains its own `.page-content` whose first child is the section's `<h2>`, so `.page-content > h2:first-child` matches every single h2 — restoring `page-break-before: auto` and undoing the universal page break. Result: PDF still shows headers mid-page.

## Fix

Tighten the exemption to only the very first h2 of the entire document (the one inside the first `.page` wrapper). Every other h2 keeps `page-break-before: always`.

### Files

1. **`supabase/functions/generate-inspection-html/index.ts`** (lines 634-641): replace the broad exemption with:
   ```css
   .page:first-of-type .page-content > h2:first-child,
   .page:first-of-type > h2:first-child {
     page-break-before: auto;
     break-before: auto;
   }
   ```

2. **`supabase/functions/generate-training-html/index.ts`** (lines 204-208): same scoped exemption.

3. **`supabase/functions/generate-daily-assessment-html/index.ts`** (lines 248-252): same scoped exemption.

### Deploy + verify

Deploy all 3 edge functions, regenerate the Solid Rock Camps inspection PDF, and confirm every blue h2 ("INSPECTION RESULTS KEY", "SYSTEMS - OPERATING SYSTEMS", "ACCT OPERATIONS STANDARDS", etc.) starts at the top of a printed page, with no blank leading page.
