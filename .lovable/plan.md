

# Fix: Equipment Fields Unresponsive Due to Unstable `onImmediateSave` Prop

## Root Cause

`triggerImmediateSave` is defined as a plain async function inside `InspectionForm.tsx` (not wrapped in `useCallback`). This means every time `InspectionForm` re-renders, a **new function reference** is created.

All 8 `EquipmentTable` components are wrapped in `React.memo()`, but `React.memo` does a shallow prop comparison. Since `onImmediateSave={triggerImmediateSave}` is a new reference on every render, `React.memo` is completely bypassed -- all 8 tables re-render on every parent state change.

Here is what happens in practice:

```text
1. User adds equipment item --> setEquipment() --> re-render
2. hasUnsavedChanges = true
3. 10-second backup interval fires autoSaveProgress()
4. performSave() throws "User not authenticated" (or any transient error)
5. setSaveError() --> InspectionForm re-renders
6. triggerImmediateSave is a NEW function reference
7. React.memo bypassed --> all 8 EquipmentTables re-render
8. GlobalAutocomplete inside each table re-renders
9. Any open popover/editing state is destroyed
10. User's typing is lost, field appears unresponsive
11. Repeat every 10 seconds (or on any state change)
```

The `equipment` array prop also changes identity on re-renders, but that is expected and necessary. The unstable `onImmediateSave` is the avoidable cause of unnecessary re-renders.

## Fix (1 file, 1 change)

**File: `src/pages/InspectionForm.tsx`**

Stabilize `triggerImmediateSave` using a ref + `useCallback` pattern. This ensures the function reference passed to `EquipmentTable` never changes, allowing `React.memo` to work correctly.

```typescript
// Add a ref that always points to the latest triggerImmediateSave implementation
const triggerImmediateSaveRef = useRef<() => Promise<void>>();

// Keep the existing triggerImmediateSave function as-is (no changes to its logic)
const triggerImmediateSave = async () => {
  // ... existing implementation unchanged ...
};

// Update the ref after every render
triggerImmediateSaveRef.current = triggerImmediateSave;

// Create a stable wrapper that delegates to the ref
const stableTriggerImmediateSave = useCallback(() => {
  return triggerImmediateSaveRef.current?.();
}, []);
```

Then replace all 8 `EquipmentTable` usages:

```diff
 <EquipmentTable
   category="harnesses"
   displayName="Harnesses"
   equipment={equipment}
   onUpdate={setEquipment}
-  onImmediateSave={triggerImmediateSave}
+  onImmediateSave={stableTriggerImmediateSave}
 />
```

Repeat for all 8 instances (harnesses, helmets, lanyards, connectors, rope, belay, trolleys, other).

## Why This Works

- The `useCallback` with empty `[]` deps creates a function reference that never changes
- The ref pattern ensures the stable wrapper always calls the latest version of `triggerImmediateSave` (with current closures over `saving`, `anySaveInProgressRef`, etc.)
- `React.memo` on `EquipmentTable` now works correctly -- tables only re-render when `equipment` array or `category` actually changes
- No more unnecessary re-renders destroying `GlobalAutocomplete` editing state

## Scope

- 1 file: `src/pages/InspectionForm.tsx`
- No changes to `EquipmentTable.tsx`, `GlobalAutocomplete.tsx`, or any other file
- No database, API, or dependency changes
- No changes to tab styling or any other functionality
- The existing `triggerImmediateSave` logic (including the `anySaveInProgressRef` concurrency lock) is completely preserved

