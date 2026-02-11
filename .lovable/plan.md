

# Fix: Autocomplete Suggestions Not Loading from Database

## The Bug

The `GlobalAutocomplete` component has a critical fetch path that is **never triggered**.

The database fetch (`fetchGlobalHistory`) is placed inside `handleOpenChange`, which is Radix Popover's `onOpenChange` callback. However, this component uses `PopoverAnchor` (not `PopoverTrigger`), so Radix **never calls `onOpenChange(true)`** -- it only calls it with `false` when dismissing the popover (click outside, Escape, etc.).

The popover is opened exclusively via `setOpen(true)` in `handleTriggerFocus`, which updates state directly and does NOT trigger the `onOpenChange` callback. Result: the database is never queried, and only localStorage data (if any) is shown.

```text
User clicks input
  -> handleTriggerFocus()
    -> setOpen(true)          -- Opens popover visually
    -> fetchGlobalHistory()   -- NEVER CALLED (not in this path)

onOpenChange(true)            -- NEVER FIRES (no PopoverTrigger exists)
  -> fetchGlobalHistory()     -- Dead code path for opening
```

## The Fix

### File: `src/components/GlobalAutocomplete.tsx`

**Change 1: Call `fetchGlobalHistory` directly in `handleTriggerFocus`**

Move the fetch trigger from `handleOpenChange` into `handleTriggerFocus`, where the popover is actually opened:

```
const handleTriggerFocus = () => {
    setIsEditing(true);
    setInputValue(value);
    if (!open) {
      setOpen(true);
    }
    // Fetch suggestions from database when input is focused
    if (!hasFetchedFromDb.current) {
      fetchGlobalHistory();
    }
  };
```

**Change 2: Also fetch when typing triggers the popover open (the `onChange` path)**

The input's `onChange` handler at line 333-337 also opens the popover via `setOpen(true)`. Add a fetch trigger there too:

```
onChange={(e) => {
  setInputValue(e.target.value);
  if (!isEditing) setIsEditing(true);
  if (!open) {
    setOpen(true);
    if (!hasFetchedFromDb.current) {
      fetchGlobalHistory();
    }
  }
}}
```

**Change 3: Remove the dead `isOpen === true` branch from `handleOpenChange`**

Since `onOpenChange(true)` is never called by Radix in this component, remove the misleading code to avoid confusion:

```
const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      // Commit on close
      if (isEditing && inputValue.trim()) {
        const trimmed = inputValue.trim();
        if (trimmed !== value) {
          onChange(trimmed);
          saveToGlobalHistory(trimmed);
        }
      }
      setIsEditing(false);
    }
    setOpen(isOpen);
  };
```

## What This Fixes

- All 20+ element names already in the database will now appear when you tap on the Element Name field
- The fetch happens on focus (first interaction), so suggestions are ready by the time you start typing
- The `hasFetchedFromDb` guard ensures it only fetches once per component mount (no repeated queries)
- localStorage continues to serve as an offline fallback

## Files Changed

| File | Change |
|------|--------|
| `src/components/GlobalAutocomplete.tsx` | Move `fetchGlobalHistory()` call to `handleTriggerFocus` and `onChange`; remove dead open-branch from `handleOpenChange` |
