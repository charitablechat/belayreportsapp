

# Enforce Default Bolt Text in Inspection Reports

## Current State

- **Database**: Already clean. Zero records in `inspection_systems` or `inspection_ziplines` contain the bolt text (cleaned in prior session).
- **Individual table rows**: `prependDefaultBolt()` already prepends the text to each system/zipline row's comments column during report generation. This is working correctly.
- **Summary "Repairs, Alterations" box**: Currently renders only `summary.repairs_performed` — the bolt text is **not** injected here.

## What Needs to Change

### 1. Inject bolt text into the Repairs summary box (edge function)

In `supabase/functions/generate-inspection-html/index.ts`, the summary section (line 2456-2467) conditionally renders `summary.repairs_performed`. Two changes:

**a)** Always render the Repairs box (even if `repairs_performed` is empty), since the bolt text must appear on every report.

**b)** Prepend the bolt text before rendering:

```typescript
// Before (line 2456-2467):
${summary.repairs_performed ? `<div>...</div>` : ""}

// After:
// Always show the repairs box with bolt text prepended
<div style="margin-bottom: 20px;">
  <div class="text-block" style="...">
    ${renderBulletList(
      parseTextToList(prependDefaultBolt(summary?.repairs_performed || "")),
      deduplicateHtmlContent(prependDefaultBolt(summary?.repairs_performed || ""))
    )}
  </div>
</div>
```

This reuses the existing `prependDefaultBolt` helper, which already deduplicates (skips if already present).

### 2. Redeploy the edge function

After the code change, redeploy `generate-inspection-html` to activate the updated logic.

### 3. No database changes needed

The previous cleanup session already removed all instances. Verification queries confirm 0 matches.

## Scope

- **1 file changed**: `supabase/functions/generate-inspection-html/index.ts` (lines 2456-2467)
- **1 redeployment**: `generate-inspection-html` edge function
- No database migrations
- No frontend changes

