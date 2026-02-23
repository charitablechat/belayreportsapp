

## Fix: Dashboard Not Refreshing After Save & Exit

### Root Cause

When a user clicks "Save & Exit" from a report, the save completes and `goBack(navigate)` navigates back to the Dashboard. However, React Router reuses the already-mounted Dashboard component -- the `useEffect([], [])` that loads all data only runs on **first mount**, not on subsequent navigations back.

The Dashboard already subscribes to `onSyncComplete` events from the background sync system, but the manual "Save & Exit" flow never emits this event. So the Dashboard shows stale data until the next automatic sync cycle (30 minutes) or a manual refresh.

### Fix

Import and call `emitSyncComplete()` from `src/lib/sync-events.ts` in the `onSave` handler of the `SaveBeforeLeaveDialog` in all three form pages. This notifies the Dashboard to reload its data immediately after the save completes.

### Files Changed

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Import `emitSyncComplete` and call it after `handleSaveAndLeave()` in the `SaveBeforeLeaveDialog` `onSave` callback |
| `src/pages/TrainingForm.tsx` | Same pattern |
| `src/pages/DailyAssessmentForm.tsx` | Same pattern |

### Technical Detail

In each form's `SaveBeforeLeaveDialog` `onSave` handler, add `emitSyncComplete()` after the save and before navigation:

```typescript
onSave={async () => {
  await handleSaveAndLeave();
  setShowLeaveDialog(false);
  setHasUnsavedChanges(false);
  emitSyncComplete(); // <-- NEW: notify Dashboard to reload
  goBack(navigate);
}}
```

The `emitSyncComplete()` function triggers the Dashboard's existing `onSyncComplete` subscription, which calls `loadInspections()`, `loadTrainingReports()`, and `loadDailyAssessments()` with fresh data.

### What's NOT Changing

- No backend/database changes
- No changes to Dashboard.tsx
- No changes to the sync system or PWA logic
- The background auto-sync behavior remains unchanged

