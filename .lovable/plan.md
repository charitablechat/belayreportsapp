

## Investigation: Missing Hard-Save Toast & Data Not Persisted

### Current State After Recent Fixes

The previous fix (decoupling toast from `appendVersion`) correctly addressed Scenario 3 (appendVersion returning null). However, **two remaining failure modes** still exist that cause the user to see no toast AND lose data.

### Failure Mode 1: Dual Mutex Deadlock (InspectionForm Only)

**Root cause:** `performSave` and `saveProgress` each maintain their own mutex ref:

```text
saveProgress()
  ├─ saveInProgressRef.current = true        ← mutex #1
  └─ performSave(false)
       ├─ anySaveInProgressRef.current = true ← mutex #2
       └─ ... save logic ...
```

The problem: `saveProgress` sets `saveInProgressRef` at line 1909, then calls `performSave` which sets `anySaveInProgressRef` at line 1292. If `performSave` throws at any point **after** setting `anySaveInProgressRef` but **before** the `finally` block in `performSave` runs, `saveProgress` catches the error and resets `saveInProgressRef`, but `anySaveInProgressRef` stays `true` forever — **blocking all future saves** (auto-save, emergency save, manual save) until page reload.

Specifically, `performSave` does `finally { anySaveInProgressRef.current = false }` at line 1805. But if the dynamic `import('@/lib/environment')` at line 1286 rejects (network error on lazy import), the function returns before `anySaveInProgressRef` is set, which is fine. However, if `getUserWithCache()` at line 1295 throws (8s timeout), or the auth check throws at line 1301, the `finally` at line 1805 correctly resets — so this path is actually safe.

**Real deadlock scenario:** The `saveProgress` wrapper has a **safety timeout at 8s** (line 1914) that force-resets `saveInProgressRef` and `saving` state. But it does **not** reset `anySaveInProgressRef`. If the server sync (lines 1483-1797) takes longer than 8s, the safety timeout fires, user clicks save again, `saveInProgressRef` is cleared so `saveProgress` proceeds, but `performSave` is still running from the first call and `anySaveInProgressRef` is still `true` — the second `performSave` call is silently skipped at line 1288. No toast, no save.

### Failure Mode 2: Training & Daily Assessment — Toast Fires Even When Save Doesn't Complete

In `TrainingForm` and `DailyAssessmentForm`, the `Promise.all(childOps)` is **not awaited** — it's fire-and-forget (`.then().catch()`). The function continues to the online sync section immediately. But the toast is inside the `.then()` callback, which is correct for success/failure feedback.

However, the **parent save** (`saveTrainingOffline(updatedTraining)`) is included in `childOps` — if it fails, the error toast shows. This path looks correct.

The remaining issue for Training/Daily: `showHardSavedToast` fires on **every** save (auto-save included) because there's no `silent` parameter. Every 1.5-second auto-save debounce triggers a toast — this floods the user with toasts and may cause toast suppression/queueing by sonner.

### Failure Mode 3: `saveProgress` Safety Timeout Doesn't Reset `anySaveInProgressRef`

This is the critical bug. In `saveProgress` (line 1914-1918):

```ts
const safetyTimeout = setTimeout(() => {
  setSaving(false);
  saveInProgressRef.current = false;
  // MISSING: anySaveInProgressRef.current = false;
}, 8000);
```

If a slow network sync exceeds 8s, this timeout fires but leaves `anySaveInProgressRef` locked. All subsequent `performSave` calls are permanently blocked.

### Summary of Remaining Issues

| Issue | Impact | Form(s) |
|-------|--------|---------|
| Safety timeout doesn't reset `anySaveInProgressRef` | Permanent save block after 8s timeout | InspectionForm |
| Toast fires on every auto-save (no `silent` guard) | Toast flood → possible suppression | TrainingForm, DailyAssessmentForm |

### Proposed Fix

**1. InspectionForm — Reset `anySaveInProgressRef` in safety timeout (line 1914-1918):**
```ts
const safetyTimeout = setTimeout(() => {
  console.warn('[InspectionForm] Safety timeout reached, forcing save state reset');
  setSaving(false);
  saveInProgressRef.current = false;
  anySaveInProgressRef.current = false; // ← ADD THIS
}, 8000);
```

Also apply the same fix to the auto-save safety timeout (around line 1870).

**2. TrainingForm & DailyAssessmentForm — Guard toast with a `silent` concept:**

Since these forms call their save function for both auto-save and manual save, but currently show the hard-saved toast on every save:
- Add a parameter or use a ref to distinguish manual vs auto saves
- Only call `showHardSavedToast` for manual saves

**3. Verify all safety timeouts across all three forms reset all mutex refs.**

### Files to Edit

- `src/pages/InspectionForm.tsx` — Add `anySaveInProgressRef.current = false` to both safety timeouts
- `src/pages/TrainingForm.tsx` — Guard `showHardSavedToast` to manual-save only; ensure safety timeout resets all refs
- `src/pages/DailyAssessmentForm.tsx` — Same as TrainingForm

