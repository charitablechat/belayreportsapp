

## Remove "Tightened bolts and connectors as needed" from Individual Report Rows

### What Changes

**File:** `supabase/functions/generate-inspection-html/index.ts`

The `prependDefaultBolt()` helper currently injects "Tightened bolts and connectors as needed" into every individual Operating System and Zipline row comment. It needs to be removed from all 4 row-level call sites while keeping it in the summary section.

### Specific Edits

**1. Remove `prependDefaultBolt` from all 4 row-level calls (lines 1901, 1954, 2025, 2105):**

Change each from:
```ts
const formattedComments = formatCommentsAsBullets(prependDefaultBolt(sys.comments));
```
to:
```ts
const formattedComments = formatCommentsAsBullets(sys.comments);
```

Same for zipline rows (`zip.comments`).

**2. Keep `prependDefaultBolt` in the summary section (line 2459) — no change needed there.** This ensures the phrase appears exactly once in the Repairs/Alterations summary.

**3. Handle empty comments gracefully.** Currently, when a row has no user comments, `prependDefaultBolt` returns the bolt text so the cell shows something. After removal, `formatCommentsAsBullets` already handles null/empty by returning "—". Rows with no user comments will correctly show "—" instead.

### Retroactivity

This is automatically retroactive — reports are generated on-demand from database data. Re-generating any existing report will use the updated logic. No data migration needed.

### Scope

- Only `generate-inspection-html` is affected (the PDF generator doesn't use this pattern)
- The summary section continues to guarantee the phrase appears once via `prependDefaultBolt`
- No changes to `InspectionForm.tsx` or any client-side code

