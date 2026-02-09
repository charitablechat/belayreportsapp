

# Fix: GlobalAutocomplete Popover Opens and Immediately Closes

## Root Cause

The bug is in `GlobalAutocomplete.tsx`, not in `InspectionForm.tsx`. It's a **Radix PopoverTrigger toggle conflict**:

1. User clicks the Input field inside `PopoverTrigger`
2. `onFocus` fires first, calling `handleTriggerFocus()` which sets `open = true`
3. React flushes this state update
4. The `click` event then fires on the `PopoverTrigger`, which has built-in toggle behavior
5. Radix reads the current `open` value (now `true`) and calls `onOpenChange(!true)` = `onOpenChange(false)`
6. The popover closes ~100ms after opening -- before the user can type anything

This matches the session replay data exactly: the dropdown opens, then closes within 86-104ms.

The previous fixes (stable callbacks, concurrency locks) were addressing real but secondary issues. This is the primary cause of the "cannot type in the Type field" bug.

## Fix (2 files, minimal changes)

### File 1: `src/components/ui/popover.tsx`

Export `PopoverAnchor` from the existing Radix package. This component positions the popover relative to an element but does NOT add click-to-toggle behavior.

```typescript
const PopoverAnchor = PopoverPrimitive.Anchor;

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
```

### File 2: `src/components/GlobalAutocomplete.tsx`

Replace `PopoverTrigger` with `PopoverAnchor` for the input wrapper. Since we already manage `open` state manually through focus/blur/keydown handlers, we don't need the trigger's toggle behavior.

```diff
 import {
   Popover,
-  PopoverTrigger,
+  PopoverAnchor,
   PopoverContent,
 } from "@/components/ui/popover";
```

```diff
-      <PopoverTrigger asChild>
+      <PopoverAnchor asChild>
         <div className="relative w-full">
           <Input ... />
         </div>
-      </PopoverTrigger>
+      </PopoverAnchor>
```

That's it. No logic changes, no new state management, no changes to any other file.

## Why This Works

- `PopoverAnchor` tells Radix "position the popover relative to this element" without adding any click/toggle handlers
- The existing `handleTriggerFocus`, `handleTriggerBlur`, and `handleTriggerKeyDown` handlers continue to manage `open` state manually -- which is what they were always designed to do
- No more conflict between the manual state management and the built-in trigger toggle

## What This Does NOT Change

- No changes to `InspectionForm.tsx` (all previous fixes remain intact)
- No changes to `EquipmentTable.tsx`
- No changes to save logic, concurrency locks, or auto-save behavior
- No database, API, or dependency changes
- No styling changes

## Verification

After applying:
1. Open an existing inspection, go to the Equipment tab
2. Click the "Type" field in any equipment row
3. The dropdown should open and STAY open
4. Type text -- it should appear in the field
5. Select an option or press Enter -- the value should commit
6. Blur away -- the popover should close cleanly

