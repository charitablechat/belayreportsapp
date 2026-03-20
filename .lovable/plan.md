

## Fix: Report Generation Timeout

### Root Cause

The `generate-inspection-html` edge function downloads photos **sequentially** in two loops:
1. Gallery photos (lines 303-350) — one-by-one
2. Per-item photos (lines 367-403) — one-by-one

Each download involves a network round-trip to Supabase Storage. With even a handful of photos, this easily exceeds the edge function's execution time limit, causing the client-side 58-second timeout to fire.

### Solution

Two changes to `supabase/functions/generate-inspection-html/index.ts`:

1. **Parallelize all photo downloads** — Replace both sequential `for` loops with `Promise.allSettled` batches. Download gallery photos and per-item photos concurrently (with a concurrency cap of 10 to avoid overwhelming the runtime).

2. **Add a total time budget for photo processing** — Set a 15-second wall-clock budget for all photo downloads combined. If any photo hasn't finished downloading within the budget, skip it gracefully and continue generating the report without those images.

### Technical Details

**File: `supabase/functions/generate-inspection-html/index.ts`**

**Gallery photos (lines 300-350):** Replace the sequential `for` loop with a parallel batch:
```typescript
const PHOTO_BUDGET_MS = 15000;
const photoStart = Date.now();

const galleryResults = await Promise.allSettled(
  photos.map(photo => downloadAndConvertPhoto(supabase, photo, photoStart, PHOTO_BUDGET_MS))
);
// Filter fulfilled results into photoDataUris
```

**Per-item photos (lines 352-403):** Similarly parallelize:
```typescript
const uniquePaths = [...new Set(allItemPhotoPaths)];
const itemResults = await Promise.allSettled(
  uniquePaths.map(path => downloadItemPhoto(supabase, path, photoStart, PHOTO_BUDGET_MS))
);
// Build itemPhotoMap from fulfilled results
```

Each helper function checks `Date.now() - photoStart > budgetMs` before starting the download and returns `null` if the budget is exceeded.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/generate-inspection-html/index.ts` | Parallelize photo downloads + add 15s time budget |

No database or frontend changes needed — the client-side timeout and rendering logic remain the same.

