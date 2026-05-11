## Status

The structural fix for this exact bug landed in the previous turn — confirmed still in place on disk:

- `GlobalAutocomplete.tsx` — `handleTriggerFocus` no longer re-seeds the local buffer on every focus event; `PopoverContent` has `onOpenAutoFocus={(e) => e.preventDefault()}`; `justSelectedRef` window extended to 400 ms.
- `DatabaseAutocomplete.tsx`, `HistoryAutocomplete.tsx`, `OrganizationAutocomplete.tsx` — same two changes (no-clobber focus, no-steal popover focus).
- `SystemTypeSelect.tsx`, `EquipmentTypeCombobox.tsx` — popover now pre-seeds its CommandInput with the current `value` (instead of empty) on open, caret at end, and refuses to commit empty over a non-empty value.
- Existing `GlobalAutocomplete.dropdown-persistence.test.tsx` (5 cases) still passes.

What's missing is what the user is now asking for explicitly: **regression tests that lock the tablet behaviour and prove desktop is unaffected**, plus a live browser pass to confirm the lived experience.

## What this plan adds

### 1. Lock the tablet contract with new unit tests

`src/components/__tests__/GlobalAutocomplete.tablet-edit-persistence.test.tsx` (new):
- Tap-focus a populated field, type extra characters directly into the trigger Input, blur to outside → committed value equals original + suffix (not just the suffix, not empty).
- Tap-focus a populated field, blur, re-focus, type → in-flight buffer survives the refocus (proves `if (!isEditing)` guard works).
- Open the popover on a populated field, close without typing → value unchanged (proves no empty-commit).
- Open popover and confirm the inner CommandInput does NOT receive focus on open (proves `onOpenAutoFocus` preventDefault).

`src/components/inspection/__tests__/EquipmentTypeCombobox.edit-existing.test.tsx` (new, mirror in `src/components/__tests__/SystemTypeSelect.edit-existing.test.tsx`):
- Open popover on a field with existing value → CommandInput is pre-filled with that value.
- Clear the CommandInput to empty and close → original value preserved.
- Edit a character and close → committed value reflects the edit, `onAddOption` fires only when the edited value is genuinely new.

### 2. Desktop regression guard

A "desktop keyboard navigation" case in each new test file:
- Focus trigger via keyboard (Tab) → popover opens; Down-arrow + Enter selects a history item; subsequent Tab leaves the field with that value committed exactly once. Confirms the touch-oriented fix didn't break arrow/Enter desktop flows.

### 3. Live preview verification

Drive the browser tool against the dashboard and an active report at tablet viewport (820×1180) and desktop (1366×768):
- Operating Systems table: tap a populated system-type cell, append text, tap outside → text now equals original + appended.
- Equipment Type cell: same.
- Inspector / On-site contact: type, lose focus briefly, refocus, continue typing → no characters lost.
- Desktop: Tab-traverse the same fields, pick an existing dropdown option with arrow keys + Enter → field commits and tab advances normally.

### 4. Out of scope

- Backend / RLS / verifiedWrite (unrelated to focus bug).
- Other input wrappers (`DebouncedInput`, `VoiceRichTextEditor`) — they don't have the popover focus-steal pattern.

## Files to add

- `src/components/__tests__/GlobalAutocomplete.tablet-edit-persistence.test.tsx`
- `src/components/__tests__/SystemTypeSelect.edit-existing.test.tsx`
- `src/components/inspection/__tests__/EquipmentTypeCombobox.edit-existing.test.tsx`

No production source files change in this turn — the fix already shipped. This turn is verification + regression locking.

## Verification

```
bunx vitest run src/components/__tests__/GlobalAutocomplete.dropdown-persistence.test.tsx \
                src/components/__tests__/GlobalAutocomplete.tablet-edit-persistence.test.tsx \
                src/components/__tests__/SystemTypeSelect.edit-existing.test.tsx \
                src/components/inspection/__tests__/EquipmentTypeCombobox.edit-existing.test.tsx
```

Then browser-tool walkthrough at both viewports as above.
