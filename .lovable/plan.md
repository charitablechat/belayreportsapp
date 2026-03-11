

## Gap Analysis: System Ordering Integrity

### What's Working (Inspections)
Inspection child tables (`inspection_systems`, `inspection_ziplines`, `inspection_equipment`) have a robust ordering pipeline:
- `display_order` column in the database
- Order stamped from array index on every save: `systems.map((s, i) => ({ ...s, display_order: i }))`
- Server queries use `.order('display_order')`
- IndexedDB reads sort by `display_order`: `results.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))`
- Edge functions (HTML/PDF report generation) also query with `.order('display_order')`

No gaps here.

### GAP FOUND: Training & Daily Assessment Child Tables Have No Ordering Guarantee

**Affected tables (6 training + 6 daily assessment):**

| Table | Has `display_order`? | Server `.order()`? | IndexedDB sort? |
|-------|---------------------|--------------------|-----------------| 
| `training_operating_systems` | No | No | No |
| `training_verifiable_items` | No | No | No |
| `training_systems_in_place` | No | No | No |
| `training_immediate_attention` | No | No | No |
| `training_delivery_approaches` | No | No | No |
| `daily_assessment_operating_systems` | No | No | No |
| `daily_assessment_*_checks` (4 tables) | No | No | No |

**Impact assessment — mostly cosmetic, one functional gap:**

Most of these tables back **checkbox UI** (predefined lists like `OPERATING_SYSTEMS`, `VERIFIABLE_ITEMS`). The display order is determined by the hardcoded array in the component, not the database order. The database just stores which items are checked. So shuffling of database rows does NOT affect what the user sees for predefined checkboxes.

**However, two concrete gaps exist:**

1. **Training "Other" custom operating systems** — Users can add multiple custom entries via "Add Custom Operating System." These are stored as `system_name: 'Other'` with an `other_description`. Since there's no `display_order` or `.order('created_at')`, multiple custom entries will appear in random order after reload. The user adds "System A" then "System B" — after save/reload, they might appear as "System B", "System A".

2. **`getTrainingDataOffline` and `getAssessmentDataOffline` return unsorted** — Unlike `getRelatedDataOffline` (inspections) which sorts by `display_order`, the training and assessment equivalents just call `index.getAll()` and return raw IndexedDB key order. If any future feature adds ordered lists to these forms, they'll shuffle silently.

### Proposed Fix (Minimal)

**No database migration needed.** The fix uses `created_at` (which all these tables already have) as a stable sort key.

1. **`src/lib/offline-storage.ts`** — Add `created_at` sorting to `getTrainingDataOffline` and `getAssessmentDataOffline`:
```ts
// getTrainingDataOffline (line ~1839)
const results = await index.getAll(trainingId);
return results.sort((a: any, b: any) => 
  new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
);

// getAssessmentDataOffline (line ~1476)  
const results = await index.getAll(assessmentId);
return results.sort((a: any, b: any) => 
  new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
);
```

2. **`src/pages/TrainingForm.tsx`** — Add `.order('created_at')` to server queries (line 500-505):
```ts
supabase.from('training_delivery_approaches').select('*').eq('training_id', id).order('created_at'),
supabase.from('training_operating_systems').select('*').eq('training_id', id).order('created_at'),
// ... same for all 6 training child queries
```

3. **`src/pages/DailyAssessmentForm.tsx`** — Add `.order('created_at')` to server queries (line 520-525):
```ts
supabase.from('daily_assessment_beginning_of_day').select('*').eq('assessment_id', id).order('created_at'),
// ... same for all 6 assessment child queries
```

4. **`supabase/functions/_shared/training-formatter.ts`** — Add `.order('created_at')` to the edge function queries (line 66-71) so generated reports also maintain consistent order.

This ensures items always appear in the order they were added, using the existing `created_at` timestamp as a stable sort key. No schema changes required.

