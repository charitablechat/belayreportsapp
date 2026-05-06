# Fix: header autocomplete values silently dropped on save

## What's broken

When a user picks or types a value in any header `GlobalAutocomplete` (Onsite Contact, Inspector, Previous Inspector, Trainer, Organization, Location), the value updates in the UI but **never persists to the server**. The DB row keeps `onsite_contact = NULL`, and `audit_logs` shows dozens of `inspections.update` events with no real diff.

This affects **inspection, training, and daily assessment** forms — every header field that uses `GlobalAutocomplete` + `onImmediateSave`.

## Why

In `InspectionHeader.tsx` (and the equivalent `TrainingHeader` / `DailyAssessmentHeader`):

```ts
onChange={(value) => {
  onUpdate("onsite_contact", value);   // queues setInspection + 500ms debounced save
  onImmediateSave?.();                  // synchronously fires performSave with STALE state
}}
```

1. `handleHeaderUpdate` queues `setInspection(updatedInspection)` and schedules a 500 ms debounced save.
2. `onImmediateSave` fires `performSave` in the **same tick**, before React re-renders.
3. `triggerImmediateSave` clears the debounced timer first, then runs the save.
4. `performSave` reads `inspection` from the current (stale) render closure — without the new value.
5. The payload matches the server, the `updated_at` trigger no-ops, and `setHasUnsavedChanges(false)` is set, so the new value is never saved.

## Fix

Make the immediate save fire **after** React has flushed the state update. Two coordinated changes:

### 1. `src/pages/InspectionForm.tsx` — `handleHeaderUpdate`

Trigger the immediate save itself (not via the child component) **after** `setInspection`, on the next microtask, so the new state is in scope when `performSave` reads its closure. Keep the 500 ms debounce as a backup if a save is already in flight.

```ts
const handleHeaderUpdate = async (field: string, value: string) => {
  // ... existing mutex wait ...
  const updatedInspection = applyTrackedFieldWrite(inspection, 'inspection', field, value);
  setInspection(updatedInspection);
  setHasUnsavedChanges(true);

  // Defer the immediate save to the next microtask so React flushes the
  // setInspection above. Without this defer, performSave reads the stale
  // closure and ships a payload missing the new value.
  if (saveDebounceTimerRef.current) clearTimeout(saveDebounceTimerRef.current);
  saveDebounceTimerRef.current = setTimeout(() => {
    performSaveRef.current?.(true);
  }, 0);
};
```

### 2. `src/components/inspection/InspectionHeader.tsx`

Remove the redundant `onImmediateSave?.()` call from every header `GlobalAutocomplete` / date picker `onChange` — the parent's `handleHeaderUpdate` now owns the save trigger:

```ts
onChange={(value) => {
  onUpdate("onsite_contact", value);
  // onImmediateSave?.() removed — handleHeaderUpdate schedules the save itself
}}
```

Apply the same change to: organization, location, inspector_name, previous_inspector, onsite_contact, inspection_date, previous_inspection_date, acct_number, course_history.

### 3. Same fix in the other two report types

Apply the identical pattern to:
- `src/components/training/TrainingHeader.tsx` (or wherever Training header autocompletes call `onImmediateSave`) and `src/pages/TrainingForm.tsx`'s header-update handler.
- `src/components/daily-assessment/DailyAssessmentHeader.tsx` (or equivalent) and `src/pages/DailyAssessmentForm.tsx`.

I'll grep for every `onImmediateSave?.()` paired with an `onUpdate(...)` call inside header components and audit each call site.

## Verification

1. Open an existing inspection, pick an Onsite Contact, wait 2 s, refresh the page. Value persists.
2. Same flow for Inspector, Previous Inspector, Organization, Location.
3. Check `audit_logs`: `inspections.update` rows now show `updated_at` advancing.
4. Repeat for a Training report and a Daily Assessment report.
5. Confirm typed-then-Enter and dropdown-pick paths both persist (both go through `handleSelect` → `onChange`).

## Out of scope

- Existing reports that already have `onsite_contact = NULL` won't be retroactively populated — only future edits. (No backfill is possible: we never had the value server-side.)
- The audit-log bloat cleanup is unrelated and already in support's hands.
