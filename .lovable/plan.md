

# Speed Up Report Generation

## Current Bottleneck Analysis

The "Generate Report" flow currently performs **5 sequential network operations**:

1. Client → Edge Function (invoke)
2. Edge Function → DB (6 parallel queries — fast, ~200ms)
3. Edge Function → Storage (batch signed URLs for photos — fast, ~100ms)
4. Edge Function → Storage **upload** the finished HTML (~500ms-2s depending on size)
5. Edge Function → Storage **create signed URL** (~100ms)
6. Client → Storage **fetch HTML** from signed URL (~500ms-1s)

Steps 4-6 add ~1-3 seconds of pure overhead. On a cold start, logo fetching adds another ~500ms.

The biggest missed optimization: **if nothing has changed since the last generation, the entire edge function runs anyway** — even though `latest_report_html` is already stored in the database row.

## Plan

### 1. Add server-side cache check (biggest win — saves 3-8s on repeat generations)

At the top of each edge function (`generate-inspection-html`, `generate-training-html`, `generate-daily-assessment-html`), compare the report's `updated_at` against `latest_report_generated_at`. If `updated_at <= latest_report_generated_at` (no edits since last generation), skip regeneration entirely — just return the existing cached HTML or its storage URL.

This means the second and subsequent clicks of "Generate Report" (with no changes) return in ~200ms instead of 3-8s.

**Files:** All 3 `generate-*-html` edge functions

### 2. Return HTML directly for small reports (eliminates 2 round trips)

Currently every report is uploaded to storage and returned as a signed URL. This adds ~1.5s. For reports under a size threshold (e.g., 1MB), return the HTML directly in the response body — the client already handles this path (`data.html` fallback). Only use the storage upload path for very large reports.

**Files:** All 3 `generate-*-html` edge functions

### 3. Client-side cache check (instant for unchanged reports)

Before even calling the edge function, check if the form has unsaved changes AND if a `latest_report_generated_at` exists that's newer than `updated_at`. If so, fetch the cached `latest_report_html` from the DB row directly — no edge function needed at all.

**Files:** `InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`

### 4. Parallelize logo fetch with DB queries

Currently logos are fetched first, then DB queries run. Since they're independent, run them in parallel. On cold starts this saves ~300-500ms.

**Files:** All 3 `generate-*-html` edge functions

## Expected Impact

| Scenario | Current | After |
|----------|---------|-------|
| First generation (cold start) | 4-8s | 3-5s |
| First generation (warm) | 3-6s | 2-4s |
| Repeat generation (no changes) | 3-6s | **< 0.5s** |

## Files Changed

1. `supabase/functions/generate-inspection-html/index.ts` — Cache check + direct HTML return + parallel logo fetch
2. `supabase/functions/generate-training-html/index.ts` — Same optimizations
3. `supabase/functions/generate-daily-assessment-html/index.ts` — Same optimizations
4. `src/pages/InspectionForm.tsx` — Client-side cache check before edge function call
5. `src/pages/TrainingForm.tsx` — Client-side cache check
6. `src/pages/DailyAssessmentForm.tsx` — Client-side cache check

