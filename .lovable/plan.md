

# Fix: Enter Key Doesn't Persist Value in GlobalAutocomplete

## Problem

When the user types "Petzl Accent" in the Type field and presses Enter, the value disappears. The data IS actually saved to the parent state, but the input displays empty because of a state inconsistency.

## Root Cause

The input displays its value using this logic:

```
value={isEditing ? inputValue : value}
```

When Enter is pressed, `handleSelect` runs:
1. `onChange("Petzl Accent")` -- parent receives the value (correct)
2. `setInputValue("")` -- clears the search text
3. `isEditing` remains `true` -- NOT reset

Result: the input shows `isEditing ? inputValue : value` = `true ? "" : "Petzl Accent"` = **empty string**

The value was saved correctly, but the input renders empty because `isEditing` is still true and `inputValue` was cleared.

The `handleTriggerKeyDown` handler (Enter on the outer input) does reset `isEditing`, but `handleInputKeyDown` (Enter on the popover's search input) does not. Since cmdk can capture focus inside the popover, the wrong handler runs.

## Fix (1 file, 1 line)

**File: `src/components/GlobalAutocomplete.tsx`**

Add `setIsEditing(false)` to `handleSelect`, so editing state is always reset when a value is committed -- regardless of which input captured the Enter key.

```typescript
const handleSelect = (selectedValue: string) => {
    onChange(selectedValue);
    saveToGlobalHistory(selectedValue);
    setOpen(false);
    setInputValue("");
    setIsEditing(false);  // <-- ADD THIS LINE
    onBlur?.();
};
```

## Why This Works

- `handleSelect` is the single commit point called by both Enter handlers and by clicking an option in the dropdown
- Setting `isEditing = false` here means the input switches to displaying the `value` prop (which was just set via `onChange`)
- The user sees "Petzl Accent" immediately after pressing Enter
- No new state, no new refs, no risk of re-triggering save loops

## What This Does NOT Change

- No changes to InspectionForm.tsx or EquipmentTable.tsx
- No changes to save logic, concurrency locks, or auto-save
- No database or API changes
- Blur-to-save behavior remains identical

