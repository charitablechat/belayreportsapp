# Fix Onsite Contact reactivity (and all header fields)

## Root cause

`InspectionForm.handleHeaderUpdate` (src/pages/InspectionForm.tsx:1016) `await`s a save-mutex check **before** calling `setInspection(...)`. If a save is in flight when the user commits a value, React state isn't updated for up to 3 seconds. Meanwhile `GlobalAutocomplete` exits edit mode on commit and renders `value={inspection?.onsite_contact || ""}` from props — which still holds the previous value. The typed name appears to vanish until the mutex resolves (or until a manual refresh re-reads from DB/IDB).

The save logic itself is correct; only the **ordering** is wrong. UI state must update synchronously the moment the parent receives the new value.

## Change (single file)

`src/pages/InspectionForm.tsx` — restructure `handleHeaderUpdate`:

1. Compute `updatedInspection` via `applyTrackedFieldWrite` (unchanged).
2. **Synchronously** set `hasUnsavedRef.current = true`, `setInspection(updatedInspection)`, `setHasUnsavedChanges(true)` — before any `await`.
3. Then perform the save-mutex wait (still up to 3 s) only to gate scheduling of the next debounced save.
4. Schedule `performSaveRef.current?.(true)` with the existing 500 ms debounce.

Net effect: input reflects the saved value instantly; debounced save still flushes to IDB/server; tracked-field-timestamps and the Realtime self-write guard remain intact.

## Out of scope

- `GlobalAutocomplete` itself (no change — it correctly reads props once edit mode exits)
- `NewInspection.tsx` onsite_contact (already a plain controlled `Input` with local `formData` state; reactive)
- Any DB schema / RLS / sync-pipeline changes
- Toast / notification logic

## Verification

1. Open an existing inspection. Type a name in **Onsite Contact**, hit Enter or click outside → name stays in the field immediately, no flicker.
2. Repeat while a save is mid-flight (rapid edits across header fields) → each commit reflects instantly; saves still flush.
3. Reload the page → value persists from DB/IDB.
4. Inspection-date, organization, location, previous-inspector all continue to behave exactly as before (they go through the same handler).
