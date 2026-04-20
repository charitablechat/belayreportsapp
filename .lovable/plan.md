

## Fix the double-exit dialog on report forms

### Root cause

When a user exits a report (back arrow, hardware back, or first-tab back), two independent guard systems both fire:

1. **Manual dialog** — back-arrow `onClick` calls `setShowLeaveDialog(true)`, opening `SaveBeforeLeaveDialog`.
2. **Router blocker** — `useUnsavedChanges` runs with `alwaysBlock: true`. As soon as the manual dialog's `onSave`/`onLeave` handler calls `navigate('/dashboard')`, `useBlocker` intercepts the navigation and opens the second dialog (`UnsavedChangesDialog`) with the same Save/Discard/Stay choices.

The user picks an option once, sees a near-identical dialog, and has to pick again — the "double exit."

This affects all three report forms:
- `src/pages/InspectionForm.tsx`
- `src/pages/TrainingForm.tsx`
- `src/pages/DailyAssessmentForm.tsx`

### Fix

Pick **one** dialog system and route every exit path through it. The cleanest option is to keep `SaveBeforeLeaveDialog` (it's the one the back-arrow already opens and the one users see first), and make its handlers tell `useUnsavedChanges` to skip the second dialog.

`useUnsavedChanges` already exposes `bypassAndProceed()` (sets `bypassRef.current = true` synchronously, so the blocker's predicate returns `false` on the next navigate). It just isn't being used by the manual exit handlers.

### Changes (per form file)

In each of the three form files:

1. **Pull `bypassAndProceed` from `useUnsavedChanges`** (already exported by the hook, no hook changes needed).
2. **Wire the `SaveBeforeLeaveDialog` handlers** to bypass before navigating:
   - `onSave`: after `handleSaveAndLeave()` finishes, call `bypassAndProceed()` then `navigate('/dashboard')` (or just call a small helper that does both).
   - `onLeave`: call `bypassAndProceed()` then `navigate('/dashboard')`.
   - `onCancel`: unchanged.
3. **Remove the now-redundant `UnsavedChangesDialog`** from the JSX of these three forms (it's covered by `SaveBeforeLeaveDialog` for in-app exits, and by the native `beforeunload` prompt for hard refresh/close which `useUnsavedChanges` still handles).

   Alternatively, keep `UnsavedChangesDialog` mounted as a **safety net** for any code path that calls `navigate(...)` without going through the back arrow (e.g., logout, sidebar links). That's the safer choice — keep it, but the bypass in step 2 ensures it never fires *after* the user already answered `SaveBeforeLeaveDialog`. Recommended: keep it.

### Files

- EDIT: `src/pages/InspectionForm.tsx` (~10 lines in 2 handlers)
- EDIT: `src/pages/TrainingForm.tsx` (~10 lines in 2 handlers)
- EDIT: `src/pages/DailyAssessmentForm.tsx` (~10 lines in 2 handlers)

No hook changes, no new files, no migrations.

### Verification after the fix

- Back arrow → one dialog → Save → goes straight to dashboard (no second prompt). ✓
- Back arrow → one dialog → Exit → goes straight to dashboard. ✓
- Hardware back on mobile (first tab) → one dialog → same behavior. ✓
- Logout / sidebar nav while on a dirty form → still shows `UnsavedChangesDialog` once (safety net intact). ✓
- Browser refresh / tab close → native `beforeunload` prompt still fires. ✓

### Risk

Tiny. The only behavior change is removing a duplicate dialog *after the user already confirmed*. Worst case: one missed `bypassAndProceed()` call leaves the existing double-dialog behavior in place (no regression). No data risk.

