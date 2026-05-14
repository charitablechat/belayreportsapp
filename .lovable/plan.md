# Dropdown values lost on navigation — root cause and fix

## What I found

Across all three report types (Inspection / Training / Daily Assessment), every text input commits its value through an explicit `onBlur={onImmediateSave}` (or `Enter` key) which flushes the debounced auto-save into IndexedDB before navigation.

**Dropdowns do not.** `updateEquipment`, `updateZipline`, `updateOperatingSystem`, and the Radix `<Select onValueChange>` calls only mutate React state and rely entirely on the parent's 1.5-second debounced `useEffect([systems, ziplines, equipment, ...])` auto-save. If the user picks a value and navigates within ~1.5s, three things can fail in combination:

1. The debounce timer hasn't fired, so nothing has been written to IDB yet.
2. `useUnsavedChanges` (`useBlocker`) only intercepts react-router navigation; it does **not** fire on tab switches inside the report or on a hard refresh fast enough to flush.
3. When the user comes back and `loadInspection` runs, it rehydrates from IDB and the dropdown change is gone.

There is no equivalent commit signal for `Select` (no blur event) — the dropdown close *is* the commit gesture, and it should behave identically to a text input losing focus.

The header's `OrganizationAutocomplete` has an explicit comment warning that calling `onImmediateSave` synchronously after a value change races React's setState and ships a stale payload. So the fix has to **defer** the save by one tick.

## Fix — single, narrow pattern

Add a microtask-deferred immediate save right after every dropdown / select-style state mutation. After `setState` flushes on the next tick, the parent's `performSave` reads fresh state and writes to IDB.

```ts
// pattern reused everywhere
const commitImmediate = () => {
  if (!onImmediateSave) return;
  setTimeout(() => onImmediateSave(), 0); // wait for React to flush state
};
```

### Files touched (presentation/wiring only — no business-logic changes)

1. **`src/components/inspection/EquipmentTable.tsx`** — `updateEquipment`: when `field` is a select-style key (`result`, `equipment_category`, `equipment_type`), call `commitImmediate()` after `onUpdate`.
2. **`src/components/inspection/ZiplinesTable.tsx`** — `updateZipline`: same treatment for `cable_type`, `cable_result`, `braking_system`, `braking_result`, `ead_system`, `ead_result`, `result`.
3. **`src/components/inspection/OperatingSystemsTable.tsx`** — same for the two `<ResultSelect>` calls.
4. **`src/components/inspection/InspectionHeader.tsx`** — `OrganizationAutocomplete` and any other `<Select>` callbacks: replace the warning-only path with deferred-immediate-save. (Keeps the existing comment's correctness — defer, don't sync.)
5. **`src/components/training/TrainingHeader.tsx`** — `location` `<Select onValueChange>`: deferred-immediate-save.
6. **`src/components/daily-assessment/*`** — any `<Select onValueChange>` paths (audited and patched the same way).

Result-row dropdowns, system-type dropdowns, header dropdowns, and `EquipmentTypeCombobox` selections (already commits via `commitValue`, but doesn't call `onImmediateSave` — wire that too) all now commit instantly.

### Why this is safe

- We are **adding** a save trigger, not changing what or how data is saved.
- It runs through the exact same `performSave` path as text-input blur, so all sync-deduplication, conflict-resolution, and offline queueing already in place is reused.
- Deferring with `setTimeout(_, 0)` honors the existing race comment in `InspectionHeader.tsx`.
- No schema, RLS, or edge-function changes. No secrets touched.

## Verification

- Unit-spec equivalent: open a report, change a dropdown, navigate away **without waiting** — return to confirm value persists.
- Repeat across Inspection, Training, Daily Assessment.
- Repeat offline (DevTools → offline) to confirm IDB persistence path.
- Check console for no new "save in flight" warnings or stale-payload Realtime overwrites.
- Existing `useUnsavedChanges` dialog should appear less often because changes are flushed sooner.

## Out of scope

- No changes to the auto-save debounce timing, save mutex, or Realtime reconciliation.
- No changes to dropdown visuals.
- No backend or RLS changes.
