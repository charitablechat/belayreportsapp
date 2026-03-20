

## Fix Report Generation: Timeout Handling & Cross-Module Reliability

### Problems Identified

**1. Silent timeout failure (all 3 report types)**
When the edge function times out, the `Promise.race` rejects with `"TIMEOUT: Report generation took too long"` at 58s. The `catch` block checks `!error.message?.includes('TIMEOUT')` and **skips showing a toast**. The safety timeout at 60s (which would show a toast) is then cleared by `finally`. Result: user sees nothing — the spinner stops but no feedback is given.

**2. Inspection edge function may be too large/slow**
The `generate-inspection-html` function is 2797 lines with embedded base64 logo fallbacks. No edge function logs are available, suggesting possible deploy issues. The function should use the shared `report-layout.ts` helper like the other two generators.

**3. Training & Daily Assessment don't use signed URL pattern**
The inspection generator uploads HTML to storage and returns a signed URL (avoiding response size limits), but training and daily assessment generators return raw HTML directly — which can fail for large reports.

### Plan

**File 1: `src/pages/InspectionForm.tsx`** — Fix timeout toast
- In the `catch` block of `handleGenerateHTML`, **show a toast for TIMEOUT errors** instead of suppressing them
- Change the condition so timeout errors get a specific, helpful message: "Report generation timed out — please check your connection and try again"

**File 2: `src/pages/TrainingForm.tsx`** — Same fix
- Same catch block fix: show toast for TIMEOUT errors

**File 3: `src/pages/DailyAssessmentForm.tsx`** — Same fix
- Same catch block fix: show toast for TIMEOUT errors

**File 4: `supabase/functions/generate-inspection-html/index.ts`** — Reliability improvements
- Import and use `getLogoBase64` from `../_shared/report-layout.ts` instead of the inline logo fetching + massive embedded base64 fallback constants (reduces file size significantly)
- Add a top-level try/catch log at function entry so errors are visible in logs
- Reduce `PHOTO_BUDGET_MS` from 15000 to 10000ms to leave more room for HTML generation and storage upload within the edge function's execution limit

### Technical Details

**Toast fix pattern (all 3 forms):**
```typescript
// BEFORE (broken):
if (!error.message?.includes('TIMEOUT')) {
  toast.error("Failed to generate report", { ... });
}

// AFTER (fixed):
if (error.message?.includes('TIMEOUT')) {
  toast.error("Report generation timed out", {
    description: "Please check your connection and try again.",
  });
} else {
  toast.error("Failed to generate report", {
    description: error.message || "Please try again.",
  });
}
```

**Inspection edge function logo change:**
```typescript
// Replace inline logo constants + getLogoBase64 function with:
import { getLogoBase64 } from "../_shared/report-layout.ts";
```

This removes ~200 lines of embedded base64 data and the inline fetch function, using the shared helper already proven in training and daily assessment generators.

### Files Changed

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Fix timeout toast suppression |
| `src/pages/TrainingForm.tsx` | Fix timeout toast suppression |
| `src/pages/DailyAssessmentForm.tsx` | Fix timeout toast suppression |
| `supabase/functions/generate-inspection-html/index.ts` | Use shared logo helper, reduce photo budget |

