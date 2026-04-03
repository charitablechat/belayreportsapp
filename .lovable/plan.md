

# Fix: Spinner Timeout During Report Generation

## Root Cause

The spinner timeout has **three distinct failure points**, all related to photo processing in the edge functions:

### 1. Edge Function Photo Download Budget (Primary Cause)
The `generate-inspection-html` function has a **10-second budget** (`PHOTO_BUDGET_MS = 10000`) to download ALL photos from Supabase Storage, convert them to Base64, and embed them as `data:` URIs. When an inspection has many photos (gallery + per-item thumbnails), this budget is easily exceeded — especially with larger images or any storage latency. Photos that miss the budget are silently skipped, producing incomplete reports.

The `generate-training-html` function is **worse** — it downloads photos **sequentially** in a `for` loop with **no time budget at all**, meaning a report with many large photos can push the entire function past the Supabase edge function timeout (~150s free / ~400s paid).

### 2. Response Size / Transfer Time
- **Inspection reports** already mitigate this by uploading HTML to storage and returning a signed URL.
- **Training and Daily Assessment reports** return the full HTML (including all Base64-embedded photos) **directly in the JSON response body**. A report with 10+ photos can easily be 20-50 MB of JSON, causing the Supabase response to truncate or the client fetch to stall within the 58-second `Promise.race` timeout.

### 3. Client-Side 60-Second Safety Timeout
All three form pages have a 60-second safety timeout that forcefully resets the spinner state. If the edge function takes longer (due to photo downloads), the user sees "Report generation timed out" even though the function may still be processing.

## Proposed Fix

### Part 1: Increase photo budget and add parallel downloads (Inspection)
**File:** `supabase/functions/generate-inspection-html/index.ts`
- Increase `PHOTO_BUDGET_MS` from 10s → 25s (well within function timeout)
- Already uses parallel downloads — no change needed

### Part 2: Add time budget and parallel downloads (Training)
**File:** `supabase/functions/generate-training-html/index.ts`
- Add a `PHOTO_BUDGET_MS = 25000` time budget
- Switch from sequential `for` loop to `Promise.allSettled()` for parallel photo downloads
- Skip photos that exceed budget (with warning log)

### Part 3: Upload-and-return-URL pattern for Training & Daily Assessment
**Files:**
- `supabase/functions/generate-training-html/index.ts`
- `supabase/functions/generate-daily-assessment-html/index.ts`
- `src/pages/TrainingForm.tsx`
- `src/pages/DailyAssessmentForm.tsx`

Apply the same pattern inspection already uses:
1. Edge function uploads HTML to `inspection-reports` bucket (or a shared `html-reports` bucket)
2. Returns a signed URL instead of raw HTML
3. Client fetches HTML from the signed URL

This eliminates the response-size bottleneck completely.

### Part 4: Increase client-side timeout to match
**Files:** `src/pages/InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`
- Increase `GENERATION_TIMEOUT` from 60s → 120s to accommodate reports with many photos
- The safety timeout already handles stuck states, so a longer window is safe

## Technical Details

- The storage upload pattern adds ~2s overhead but eliminates the multi-MB JSON response problem
- Parallel photo downloads with `Promise.allSettled` prevent one slow photo from blocking all others
- The 25s photo budget allows ~25 photos at ~1s each (typical Supabase Storage download time)
- Photos that fail or exceed budget are gracefully skipped with console warnings

## Summary of Changes

| File | Change |
|------|--------|
| `generate-inspection-html/index.ts` | Increase photo budget 10s → 25s |
| `generate-training-html/index.ts` | Add 25s budget, parallelize downloads, upload-to-storage pattern |
| `generate-daily-assessment-html/index.ts` | Upload-to-storage pattern (no photos but future-proofs) |
| `src/pages/TrainingForm.tsx` | Handle `htmlUrl` response, increase timeout to 120s |
| `src/pages/DailyAssessmentForm.tsx` | Handle `htmlUrl` response, increase timeout to 120s |
| `src/pages/InspectionForm.tsx` | Increase timeout to 120s |

