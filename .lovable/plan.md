

# Audit: Loading & Uploading Spinner Issues

## Issues Found

### 1. Inspection PDF Generation: No Safety Timeout (Critical)
**File:** `src/pages/InspectionForm.tsx` (lines 2091-2274)
The `handleGeneratePDF` function sets `generatingPdf = true` but has NO safety timeout — only a `try/finally`. If `supabase.functions.invoke` hangs (network stall, edge function timeout without response), the spinner stays permanently. Both HTML generation and Training PDF have safety timeouts; Inspection PDF does not.

**Fix:** Add a `GENERATION_TIMEOUT = 120000` safety timeout matching the HTML generation pattern.

### 2. Training PDF Generation: No Safety Timeout (Critical)
**File:** `src/pages/TrainingForm.tsx` (lines 963-1003)
Same issue as above — `setIsGeneratingPDF(true)` with only `try/finally`, no safety timeout. If the edge function hangs, spinner is permanent.

**Fix:** Add matching safety timeout.

### 3. Training PDF Generation: No Error Toast (UX Gap)
**File:** `src/pages/TrainingForm.tsx` (line 1000)
The catch block only does `console.error` — no `toast.error()`. User sees spinner stop but gets zero feedback on failure.

**Fix:** Add `toast.error("Failed to generate PDF")` in catch block.

### 4. Inspection PDF Generation: No Error Toast (UX Gap)
**File:** `src/pages/InspectionForm.tsx` (lines 2254-2269)
Same issue — extensive logging but no user-visible error notification.

**Fix:** Add `toast.error()` with contextual message based on error type.

### 5. OptimizedImage `handleError` Return Value Leak
**File:** `src/components/ui/optimized-image.tsx` (line 101)
`handleError` returns a cleanup function (`return () => clearTimeout(timer)`) from inside a `useCallback`. Since this is an `onError` event handler, the return value is ignored — the timeout is never cleaned up if the component unmounts during the 3s retry window.

**Fix:** Store the timer in a ref and clear it on unmount via a `useEffect` cleanup.

### 6. PhotoCapture: `Upload` Icon Spinning as Loading Indicator
**File:** `src/components/PhotoCapture.tsx` (line 332)
Uses `<Upload className="animate-spin" />` which looks odd — the Upload icon isn't circular. Should use `Loader2` (the standard spinner icon used everywhere else).

**Fix:** Replace `Upload` with `Loader2` in the uploading state.

### 7. PhotoGallery Loading Spinner: No Timeout
**File:** `src/components/PhotoGallery.tsx` (line 599-604)
If `loadPhotos` throws before reaching `finally`, or if `getOfflinePhotos` hangs (IndexedDB locked), the `loading` state stays `true` forever showing an infinite spinner. There's no safety timeout.

**Fix:** Add a 15s safety timeout that force-sets `loading = false`.

## Proposed Changes

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Add 120s safety timeout to `handleGeneratePDF`, add error toast |
| `src/pages/TrainingForm.tsx` | Add 120s safety timeout to `handleGeneratePDF`, add error toast |
| `src/components/ui/optimized-image.tsx` | Store retry timer in ref, clear on unmount |
| `src/components/PhotoCapture.tsx` | Replace `Upload` spinning icon with `Loader2` |
| `src/components/PhotoGallery.tsx` | Add 15s safety timeout to initial photo load |

