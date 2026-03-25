

## Fix: Exclude Deleted Photos from Generated Reports

### Problem
When photos are soft-deleted in the app, the **inspection HTML report generator** still includes them because it doesn't filter out records with a non-null `deleted_at` timestamp. The PDF generator and training reports already have this filter.

### Change

**File: `supabase/functions/generate-inspection-html/index.ts` (line ~224)**

Add `.is('deleted_at', null)` to the `inspection_photos` query, matching the pattern already used in the PDF generator:

```
// Before
supabase.from("inspection_photos").select("*").eq("inspection_id", inspectionId)

// After
supabase.from("inspection_photos").select("*").eq("inspection_id", inspectionId).is("deleted_at", null).order("display_order")
```

This is the only file that needs updating. The other report generators (`generate-inspection-pdf`, `training-formatter`) already filter correctly.

### Impact
- Retroactive: all existing reports will exclude deleted photos when regenerated
- Future reports will automatically respect soft-deletes

| File | Change |
|------|--------|
| `supabase/functions/generate-inspection-html/index.ts` | Add `.is('deleted_at', null)` filter to photo query |

