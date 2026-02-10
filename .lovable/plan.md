

# Comprehensive Codebase Audit -- Issues and Fixes

## Issue 1: Back Button Broken on TrainingForm and DailyAssessmentForm (Same Bug as InspectionForm)

**Severity: High**

The same back button issue we just fixed in `InspectionForm.tsx` exists in both `TrainingForm.tsx` and `DailyAssessmentForm.tsx`. These forms have NO `isInternalUpdateRef` guard at all, meaning `hasUnsavedChanges` is set to `true` on every initial data load, blocking navigation via `useBlocker`.

**TrainingForm.tsx (line 565-589):** The change-tracking `useEffect` unconditionally sets `setHasUnsavedChanges(true)` when `deliveryApproaches`, `operatingSystems`, etc. change -- including during initial load at lines 274-285 and server data load at lines 350-358.

**DailyAssessmentForm.tsx (line 209-233):** Same pattern -- `setHasUnsavedChanges(true)` fires whenever `beginningOfDay`, `endOfDay`, etc. change, including initial load at lines 271-276 and server load at lines 334-339.

**Fix:** Add the same `isInternalUpdateRef` pattern used in InspectionForm:
- Add `const isInternalUpdateRef = useRef(false)` to both forms
- Guard the change-tracking `useEffect` with `if (!isInternalUpdateRef.current)`
- Add a reset `useEffect` that clears the ref after the watcher skips
- Set `isInternalUpdateRef.current = true` before all programmatic data loads (offline and server)

### TrainingForm.tsx changes:
1. Add `isInternalUpdateRef` ref declaration (~line 84)
2. Guard the auto-save watcher at line 569 with `if (!isInternalUpdateRef.current)`
3. Add reset effect after the watcher
4. Set guard before offline data load (line 274)
5. Set guard before server data load (line 350)
6. Set guard before auto-populate summary (line 236, inside `setSummary`)

### DailyAssessmentForm.tsx changes:
1. Add `isInternalUpdateRef` ref declaration (~line 87)
2. Guard the auto-save watcher at line 213 with `if (!isInternalUpdateRef.current)`
3. Add reset effect after the watcher
4. Set guard before offline data load (line 271)
5. Set guard before server data load (line 334)

---

## Issue 2: Missing Online Guard on Profile Fetches (Crashes Offline)

**Severity: Medium**

In `TrainingForm.tsx` (line 141) and `DailyAssessmentForm.tsx` (line 137), the `fetchInspectorProfile` effect does NOT check `navigator.onLine` before calling `supabase.from('profiles').select(...)`. The InspectionForm correctly has `if (!inspectorId || !navigator.onLine) return;` but these two forms only check `if (!inspectorId) return;`.

This means opening a training or daily assessment while offline will trigger a network request that silently fails, and `.single()` will throw an error on no results.

**Fix:** Add `!navigator.onLine` guard to the `fetchInspectorProfile` effect in both files.

---

## Issue 3: Duplicate Sync on iOS (useIOSSync + useAutoSync)

**Severity: Low**

`useIOSSync.tsx` registers its own `visibilitychange`, `focus`, `online`, and `pageshow` event listeners with a 60-second polling interval. However, `useAutoSync.tsx` (lines 345-411) already registers the exact same listeners with iOS-specific handling (pageshow, focus). Both hooks run concurrently, causing **double sync** on every visibility change, focus, and reconnect event for iOS users.

**Fix:** Remove the `useIOSSync` hook entirely since `useAutoSync` already handles all iOS-specific sync behavior. Remove its usage from any component that imports it.

---

## Issue 4: Training Auto-populate Summary Triggers Unsaved Changes

**Severity: Medium**

In `TrainingForm.tsx` (line 236), the auto-populate effect calls `setSummary({ ...summary, ...updates })` which triggers the change-tracking watcher at line 565, setting `hasUnsavedChanges = true`. This is another path that needs the `isInternalUpdateRef` guard (covered in Issue 1 fix).

---

## Issue 5: Production Console Logging

**Severity: Low**

Several `console.log` statements in `TrainingForm.tsx` and `DailyAssessmentForm.tsx` are NOT guarded by `import.meta.env.DEV`:
- TrainingForm: lines 408, 412, 443, 538, 543, 536, 579, 599
- DailyAssessmentForm: lines 223, 239, 427, 453, 462, 487, 559, 571

These log to production users' consoles, which is noisy and unprofessional.

**Fix:** Wrap all non-error `console.log` calls with `if (import.meta.env.DEV)` guards.

---

## Summary Table

| # | Issue | Severity | File(s) | Fix |
|---|-------|----------|---------|-----|
| 1 | Back button blocked on Training/DailyAssessment forms | High | TrainingForm.tsx, DailyAssessmentForm.tsx | Add `isInternalUpdateRef` pattern |
| 2 | Missing online guard on profile fetch | Medium | TrainingForm.tsx, DailyAssessmentForm.tsx | Add `!navigator.onLine` check |
| 3 | Duplicate iOS sync (useIOSSync + useAutoSync) | Low | useIOSSync.tsx | Remove hook; useAutoSync covers it |
| 4 | Auto-populate triggers unsaved changes | Medium | TrainingForm.tsx | Covered by Issue 1 fix |
| 5 | Production console logging | Low | TrainingForm.tsx, DailyAssessmentForm.tsx | Add DEV guards |

## Implementation Order

1. Fix Issues 1+4 (TrainingForm.tsx -- `isInternalUpdateRef` + online guard)
2. Fix Issues 1+2 (DailyAssessmentForm.tsx -- `isInternalUpdateRef` + online guard)
3. Fix Issue 3 (Remove useIOSSync hook)
4. Fix Issue 5 (DEV guards on console.log -- can be done in parallel with above)

