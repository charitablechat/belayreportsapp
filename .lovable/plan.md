

## Problem
From the session replay + video context: when the user clicks the equipment-type dropdown on a row, the input shows a validation error (red `ring-destructive` border) and the popover dropdown closes / won't stay open after selection. The dropdown effectively can't be used reliably on any row beyond the first.

## Root cause analysis

Looking at `EquipmentTypeCombobox.tsx` and `SystemTypeSelect.tsx`:

1. **Trigger is an `<Input>` inside `PopoverTrigger asChild`** — Radix forwards events to the Input. Every keystroke / focus shift in the trigger Input fires focus/blur cycles that interact badly with the Popover open state.

2. **`handleTriggerBlur` runs a 200ms `setTimeout` that calls `onBlur?.()` and commits the value** — when the user clicks an option in the popover, the trigger Input blurs first. The setTimeout fires, calls `onBlur` (which likely triggers form validation → red error border), and resets `isEditing`. Meanwhile the CommandItem's `onSelect` also fires. Race conditions cause the popover to close before selection registers, or the validation to flash.

3. **Two competing input surfaces** — both the trigger `<Input>` and the `<CommandInput>` inside the popover accept typing. Focus bounces between them, closing the popover.

4. **Popover closes on outside click** — clicking from row 1's popover into row 2 counts as outside click for row 1, but the blur handler on row 1 commits a value and fires validation, while row 2 is trying to open. They fight.

## Fix

Refactor `EquipmentTypeCombobox` and `SystemTypeSelect` so the popover stays open reliably:

1. **Remove the trigger as an editable Input.** Use a read-only Input (or button styled as one) as the `PopoverTrigger`. All typing happens inside the `<CommandInput>` in the popover. This eliminates the dual-input focus race.

2. **Open the popover on click/focus**, autofocus the `CommandInput` when it opens.

3. **Drop the 200ms blur timeout entirely.** Commit values only on:
   - Explicit selection (CommandItem click)
   - Enter key in CommandInput
   - Popover `onOpenChange(false)` (closing) — commit pending search text if non-empty

4. **Stop calling `onBlur?.()` on every focus loss** — only call it once, when the popover actually closes. This prevents the parent's validation from flashing red mid-interaction.

5. **Ensure each row's popover is independent** — Radix Popover already portals, so this should work once focus races are removed.

## Files to modify
- `src/components/inspection/EquipmentTypeCombobox.tsx` — refactor to read-only trigger + popover-only editing
- `src/components/SystemTypeSelect.tsx` — same refactor (mirror component)

Both components share the exact same buggy pattern, so the same fix applies.

## What this fixes
- Dropdown stays open until the user explicitly selects, presses Enter, presses Escape, or clicks outside
- No more red validation flash mid-selection
- Works identically on row 1, row 2, row 3, row N
- Selection from popover always commits cleanly
- No more focus-bounce between trigger Input and CommandInput

