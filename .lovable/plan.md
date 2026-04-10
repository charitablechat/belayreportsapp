

# Fix: Report Generation Lag and Performance Bottleneck

## Root Causes Identified

### Cause 1: Photo Downloads in Edge Functions (Primary — 10-25s)
Every "Generate Report" call triggers `generate-inspection-html` (2772 lines), which downloads **every photo** from Supabase Storage and converts each to base64 inline. With a 25-second budget and sequential storage API calls, this dominates execution time. The same pattern exists in `generate-training-html`.

### Cause 2: Logo Fetches on Every Generation (~1-2s)
`getLogoBase64()` fetches two logo PNGs from storage and converts to base64 on every single report generation — these never change but are re-downloaded every time.

### Cause 3: IndexedDB Circuit Breaker Tripping During Generation
The console logs show `removeQueuedAssessmentOperation` being called with `undefined` IDs (the queued operations lack an `id` field), causing `DataError: No key or key range specified`. This trips the circuit breaker, disabling IndexedDB for 60s and causing cascading timeout warnings that degrade the entire UI during report generation.

### Cause 4: No Auto-Save Flush Before Generation
When the user clicks "Generate Report," any unsaved edits haven't been persisted to the server yet. The edge function reads stale data from the database, and there's no flush-and-wait step.

## Fix Plan

### Step 1: Fix undefined ID crashes in queue cleanup
**File:** `src/hooks/useAutoSync.tsx`

Filter out operations with falsy `id` before calling `remove*` functions. This eliminates the `DataError` crashes and circuit breaker trips.

```typescript
// Before removal, filter out entries without valid IDs
const staleInsp = inspOps.filter(op => op.id && !op?.data?.deleted_at);
const staleTrain = trainOps.filter(op => op.id && !op?.data?.deleted_at);
const staleAssess = assessOps.filter(op => op.id && !op?.data?.deleted_at);
```

### Step 2: Cache logos in edge functions
**File:** `supabase/functions/_shared/report-layout.ts`

Add module-level caching so logos are fetched once per cold start (edge functions persist across warm invocations):

```typescript
let cachedLogos: { ropeWorks: string; acct: string } | null = null;

export async function getLogoBase64() {
  if (cachedLogos) return cachedLogos;
  // ...existing fetch logic...
  cachedLogos = result;
  return cachedLogos;
}
```

### Step 3: Use signed URLs instead of base64 for photos
**File:** `supabase/functions/generate-inspection-html/index.ts`

Replace the expensive download-and-convert-to-base64 loop with `createSignedUrl()` calls (which return instantly without downloading file content). This eliminates the 10-25s photo processing budget entirely.

- Gallery photos: use signed URLs (valid 24h) in `<img src="...">` tags
- Item photos: same approach
- Fallback: keep base64 conversion only for PDF generation (where signed URLs won't work)

**Same change in:** `supabase/functions/generate-training-html/index.ts`

### Step 4: Flush unsaved changes before generating
**File:** `src/pages/InspectionForm.tsx`

Add a save-flush step at the start of `handleGenerateHTML`:

```typescript
const handleGenerateHTML = async () => {
  // Flush any pending changes to ensure edge function reads fresh data
  if (hasUnsavedChanges) {
    await saveProgress();
  }
  // ...existing generation logic...
};
```

**Same pattern in:** `TrainingForm.tsx`, `DailyAssessmentForm.tsx`

### Step 5: Add progress feedback
Show a more informative toast during generation so users know the system is working:

```typescript
const toastId = toast.loading("Generating report...");
// ... after completion:
toast.dismiss(toastId);
```

## Files Changed
1. `src/hooks/useAutoSync.tsx` — guard against undefined IDs in queue cleanup
2. `supabase/functions/_shared/report-layout.ts` — module-level logo cache
3. `supabase/functions/generate-inspection-html/index.ts` — signed URLs for photos instead of base64
4. `supabase/functions/generate-training-html/index.ts` — same signed URL optimization
5. `src/pages/InspectionForm.tsx` — flush unsaved changes + progress toast
6. `src/pages/TrainingForm.tsx` — flush unsaved changes + progress toast
7. `src/pages/DailyAssessmentForm.tsx` — flush unsaved changes + progress toast

## Expected Impact
- **Photo processing:** 10-25s → ~1-2s (signed URLs are near-instant vs downloading files)
- **Logo fetching:** 1-2s → 0ms on warm invocations
- **IndexedDB crashes:** Eliminated (no more undefined ID deletions)
- **Data freshness:** Guaranteed by pre-generation flush

