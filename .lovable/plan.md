

## Add Missing "Overall" Column to Zipline Table in Generated Report

### Problem
The zipline table in the generated inspection HTML report is missing the "Overall" result column. The data exists in the database (`inspection_ziplines.result`) but is not rendered in the report. It should display with the same color-coded styling (green/red/orange) as Cable Result, Braking Result, and EAD Result.

### File: `supabase/functions/generate-inspection-html/index.ts`

### Changes

**1. Update CSS column widths (lines 792-810)**

The comment says "9 columns" but it needs to be 10 columns. Add a new column definition for the Overall result (nth-child(9)) and shift Comments to nth-child(10). Redistribute widths slightly to accommodate the extra column.

**2. Update combined ziplines table header (line 1923)**

Add `<th>Overall</th>` between "EAD Result" and "Comments and/or Required Changes".

**3. Update combined ziplines table row (lines 1933-1944)**

Add Overall result cell using `formatResultCheckbox(zip.result || "Pass")` between the EAD Result cell and the Comments cell.

**4. Update separate ziplines table header (line 2071)**

Same change -- add `<th>Overall</th>` between "EAD Result" and "Comments".

**5. Update separate ziplines table row (lines 2081-2091)**

Same change -- add the Overall result cell between EAD Result and Comments.

**6. Update all CSS nth-child references that target ziplines columns**

Any existing CSS rules referencing `ziplines-table td:nth-child(9)` (currently Comments) need to shift to `nth-child(10)`. This appears in at least 3 places in the stylesheet.

### Deployment

Redeploy `generate-inspection-html` after changes.

### Result

The Overall column will render with the same `formatResultCheckbox()` styling as other result columns -- green background for Pass, red for Fail, orange for Pass w/Provisions -- in both the HTML view and PDF output.
