## Problem

In `GlobalAutocomplete`, picking an item (or re-picking the same item) causes a visible flicker: the popover closes on selection, Radix's `FocusScope` restores focus to the trigger Input, and the trigger's `onFocus` handler is on the verge of reopening it. We currently paper over that race with a `justSelectedRef` 400ms suppression flag — which itself causes the "blink" the user is reporting and makes a genuine re-tap feel unreliable.

The user wants the dropdown to behave like a stable menu: open on focus/click, **stay open** through selections, close only on explicit dismissal (click outside, Escape, or Tab away).

## Fix

Edit only `src/components/GlobalAutocomplete.tsx`. No behavior changes elsewhere.

1. **Keep the popover open on selection.** In `handleSelect`, remove `setOpen(false)`. Commit the value via `onChange`, mirror it into local state, persist to history, and defer `onBlur` (already does this) — but leave `open === true`.
2. **Remove the `justSelectedRef` workaround.** Delete the ref, its setter in `handleSelect`, and the early-return branch in `handleTriggerFocus`. With the popover staying open there's no unmount → focus-restore → reopen race to suppress.
3. **Explicit dismissal paths remain:**
   - Click outside → Radix `onOpenChange(false)` → existing `handleOpenChange` commits and closes.
   - `Escape` in trigger → existing branch in `handleTriggerKeyDown` already closes and blurs.
   - `Enter` to commit + jump cell → still closes (`focusNextCell` moves focus away, Radix closes the popover via outside-focus).
   - `handleClear` (the X button) → still closes explicitly.
4. **Update the regression test** `src/components/__tests__/GlobalAutocomplete.dropdown-persistence.test.tsx`:
   - Replace the "focus-restore does NOT reopen" test with "popover stays open after selection and the trigger Input shows the picked value".
   - Replace the "after suppression window, re-focus reopens" test with "clicking outside (Radix onOpenChange false) closes the popover, and a subsequent focus reopens it".
   - The `onChange called once` and `Enter commits typed value` tests stay as-is.
5. **Update memory** `mem://constraints/autocomplete-select-defer-onblur.md` to reflect the new contract: "popover stays open through selection; closure is user-initiated only" and remove the now-stale `justSelectedRef` note.

## Out of scope

- No changes to `SystemTypeSelect` or any other dropdown component.
- No changes to save / sync / history logic.
- No changes to styling beyond what already exists.

## Files touched

- `src/components/GlobalAutocomplete.tsx` (edit)
- `src/components/__tests__/GlobalAutocomplete.dropdown-persistence.test.tsx` (edit)
- `mem://constraints/autocomplete-select-defer-onblur.md` (edit)
