
## Fix: Back Navigation Blocked in Training Form (and All Three Report Forms)

### Root Cause

All three report forms (Training, Inspection, Daily Assessment) have two separate navigation-guard systems running simultaneously:

1. **`useBlocker` (from `useUnsavedChanges`)** — intercepts ALL programmatic `navigate()` calls when `hasUnsavedChanges` is `true`. This is a React Router-level blocker that catches every SPA navigation.

2. **`SaveBeforeLeaveDialog`** — a manual confirmation modal opened when the user clicks the back arrow or swipes right on the first tab.

**The conflict:** When the user clicks "Save & Exit" or "Discard & Exit" in the `SaveBeforeLeaveDialog`, the handlers call `goBack(navigate)` → `navigate(-1)`. At that instant, `hasUnsavedChanges` is still `true`, so the `useBlocker` intercepts the `navigate(-1)` call and blocks it. The navigation never completes — the user is stuck on the page with no visible feedback.

This is the same bug in all three forms:
- `src/pages/TrainingForm.tsx` → `onSave` / `onLeave` call `goBack(navigate)` while blocker is active
- `src/pages/InspectionForm.tsx` → same pattern
- `src/pages/DailyAssessmentForm.tsx` → same pattern

### Scope

The bug affects:
- Back arrow button in all three report form headers
- Swipe-right-on-first-tab gesture in all three forms (all trigger `setShowLeaveDialog(true)`)

The **"New" creation screens** (NewTraining, NewInspection, NewDailyAssessment) are NOT affected — they use the simpler `DiscardDraftDialog` without `useBlocker`.

---

### The Fix

The fix is simple and identical for all three files. In the `SaveBeforeLeaveDialog`'s callbacks, `hasUnsavedChanges` must be set to `false` **before** calling `goBack(navigate)`, so the `useBlocker` releases its hold before the navigation fires.

**For the "Save & Exit" path:** `handleSaveAndLeave()` already calls `setHasUnsavedChanges(false)` internally at the end. But the navigation call happens in the dialog callback (`onSave`) after awaiting it — at this point the state update may not have flushed yet in the same render cycle. The fix: explicitly call `setHasUnsavedChanges(false)` synchronously right before `goBack(navigate)`.

**For the "Discard & Exit" path:** `hasUnsavedChanges` is never cleared, so the blocker intercepts the navigation. The fix: call `setHasUnsavedChanges(false)` before `goBack(navigate)`.

---

### Changes Required

All three changes are mechanically identical — only the file differs.

#### `src/pages/TrainingForm.tsx` (lines ~1107–1121)

```tsx
// BEFORE
<SaveBeforeLeaveDialog
  open={showLeaveDialog}
  onOpenChange={setShowLeaveDialog}
  onSave={async () => {
    await handleSaveAndLeave();
    setShowLeaveDialog(false);
    goBack(navigate);
  }}
  onLeave={() => {
    setShowLeaveDialog(false);
    goBack(navigate);
  }}
  ...
/>

// AFTER
<SaveBeforeLeaveDialog
  open={showLeaveDialog}
  onOpenChange={setShowLeaveDialog}
  onSave={async () => {
    await handleSaveAndLeave();
    setShowLeaveDialog(false);
    setHasUnsavedChanges(false);   // ← release blocker BEFORE navigate
    goBack(navigate);
  }}
  onLeave={() => {
    setShowLeaveDialog(false);
    setHasUnsavedChanges(false);   // ← release blocker BEFORE navigate
    goBack(navigate);
  }}
  ...
/>
```

#### `src/pages/InspectionForm.tsx` (lines ~2130–2144)

Same `setHasUnsavedChanges(false)` added before `goBack(navigate)` in both `onSave` and `onLeave`.

**Note:** In `InspectionForm`, the state setter is also named `setHasUnsavedChanges` — confirmed in the file.

#### `src/pages/DailyAssessmentForm.tsx` (lines ~1205–1219)

Same fix. The state variable is also `hasUnsavedChanges` / `setHasUnsavedChanges`.

---

### Why This Works

React Router's `useBlocker` evaluates its condition (the `hasUnsavedChanges` value) at the time the navigation is dispatched. By calling `setHasUnsavedChanges(false)` synchronously before `goBack(navigate)`, React batches the state update so that when `navigate(-1)` fires in the same event handler, the blocker's condition evaluates to `false` and allows the navigation through. No dialog conflict occurs.

---

### No Other Files Need Changing

- `useUnsavedChanges.tsx` — no change
- `SaveBeforeLeaveDialog.tsx` — no change  
- `navigation.ts` — no change
- `App.tsx` — no change
- New-report screens — not affected (they don't use `useBlocker`)
