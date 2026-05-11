## What's actually happening

The "text disappears" symptom on tablets is not a save/persistence failure — it's an input-focus bug in our combobox-style fields. Three patterns produce the same visible result:

**A. `SystemTypeSelect` and `EquipmentTypeCombobox` (used in operating-systems / equipment tables)**

The visible field is a *button*, not a text input. The actual editable text lives inside a `CommandInput` (the popover's search box), and it starts **empty** every time the popover opens. On tablets the soft keyboard immediately covers the popover, so the user thinks they're editing the existing text in place. Whatever they type is the *search filter*, and on popover close `handleOpenChange` does `commitValue(searchValue)` → the original value is replaced with the search string. If they tap outside without typing anything the original survives, but the moment they touch a key, the value is overwritten.

**B. `GlobalAutocomplete` (used for inspector names, contacts, equipment, ziplines, etc.)**

The trigger is a real `Input`, but `handleTriggerFocus` does three things on *every* focus event:
1. `setIsEditing(true)`
2. `setInputValue(value)` — overwrites any in-flight local edit with the prop value
3. `setOpen(true)` — opens the popover, whose `PopoverContent` does not preventDefault on `onOpenAutoFocus`, so focus jumps to the inner `CommandInput`.

Two failure modes follow:
- User starts typing in the trigger Input, taps away briefly (tablet keyboard collapse / autocorrect bar / scroll), refocuses → `handleTriggerFocus` re-runs → `setInputValue(value)` wipes everything they typed.
- User taps an already-populated field intending to edit. Focus lands on the trigger, then Radix's FocusScope hands focus to the inner `CommandInput`. The CommandInput is bound to the same `inputValue` state. They type to edit "Old Value" → on close `handleOpenChange` commits `inputValue` (the search term) → original is replaced.

**C. After picking a dropdown option, continuing to type**

`handleSelect` calls `setInputValue(selectedValue); setIsEditing(false)` then `justSelectedRef` suppresses the focus-restore reopen (covered by the existing dropdown-persistence test). But the next genuine refocus runs `handleTriggerFocus` again, which (1) reopens the popover and (2) overwrites `inputValue` — same loss pattern as B.

The tablet specificity comes from soft-keyboard focus thrash and from users not seeing the popover (it's hidden under the keyboard), so they don't realize they're typing into a filter, not the field.

## Fix

### 1. `SystemTypeSelect` and `EquipmentTypeCombobox`

- When the popover opens, **pre-seed `searchValue` with the current `value`** instead of `""`, and place the caret at end of the CommandInput so editing existing text is the obvious affordance.
- Keep `searchValue` as the single source of edit truth (it already commits on close).
- When the popover closes with `searchValue.trim() === value.trim()`, don't call `commitValue` — no-op (already true via the `trimmed !== value` guard, keep it).
- If the user clears the field to empty inside the popover and closes, treat that as a no-op (don't blow away a non-empty value with empty). Only commit when `searchValue.trim()` is non-empty OR the user explicitly used the clear button (we'll add a separate "Clear" affordance if requested — out of scope for this fix).

### 2. `GlobalAutocomplete`

- Stop unconditionally overwriting `inputValue` on focus. Change `handleTriggerFocus` so it only seeds `inputValue` from `value` **when transitioning from non-editing to editing AND `inputValue` is empty or equals the previous committed value**. In effect: don't clobber an in-flight edit.
- Add `onOpenAutoFocus={(e) => e.preventDefault()}` to `PopoverContent` so opening the popover doesn't yank focus away from the trigger Input. The trigger Input is already wired to update `inputValue` via its own `onChange`, so users edit directly in the field they tapped.
- Keep the CommandInput in the popover but make it cosmetic-only on touch: its `onValueChange` should not be writable by the user — render it as a non-input "current edit" preview, or simply hide it on touch devices and let the trigger Input drive filtering. Simpler: keep CommandInput but bind its `value` one-way to `inputValue` and route its `onValueChange` through the same setter — but ALSO ensure the trigger keeps focus so users never tab into the CommandInput unintentionally. The `onOpenAutoFocus` preventDefault is the primary fix; CommandInput stays for keyboard users.
- In `handleOpenChange(false)`, before committing `inputValue`, guard with `inputValue.trim().length > 0` — never overwrite a previous non-empty value with an empty commit unless the user used the explicit Clear (X) button. The X button still goes through `handleClear` which explicitly calls `onChange("")` — unchanged.
- After `handleSelect`, also clear `justSelectedRef` only after a longer 400ms window for slow tablet focus restores (current 200ms occasionally races on iPad Safari).

### 3. Audit pass on remaining autocomplete components

Read `DatabaseAutocomplete.tsx`, `HistoryAutocomplete.tsx`, `OrganizationAutocomplete.tsx` and apply the same two rules:
- Never overwrite local edit buffer on refocus.
- Never commit empty-string over a previously non-empty value implicitly; require an explicit clear gesture.

### 4. Regression tests

Add a `GlobalAutocomplete.tablet-edit-persistence.test.tsx` companion to the existing dropdown-persistence test covering:
- Tap populated field, type additional characters in the trigger Input, tap outside → committed value equals original + typed suffix (not just the suffix, not empty).
- Tap populated field, lose focus, refocus, type → in-flight buffer survives the refocus.
- Tap populated field, open popover, close without typing → value unchanged.

Add an `EquipmentTypeCombobox.edit-existing.test.tsx` covering:
- Open popover on a field with existing value → CommandInput is pre-filled with that value with caret at end.
- Edit a character, close → committed value reflects the edit.
- Close with empty searchValue → original value preserved (no implicit wipe).

### 5. No backend or data-layer changes

This is entirely a frontend input-state fix. RLS, `verifiedWrite`, and the announcements save path are not involved — those were the previous turn's audit and are already in place.

## Files touched

- `src/components/SystemTypeSelect.tsx`
- `src/components/inspection/EquipmentTypeCombobox.tsx`
- `src/components/GlobalAutocomplete.tsx`
- `src/components/DatabaseAutocomplete.tsx` (audit + same fixes if pattern matches)
- `src/components/HistoryAutocomplete.tsx` (audit + same fixes if pattern matches)
- `src/components/OrganizationAutocomplete.tsx` (audit + same fixes if pattern matches)
- `src/components/__tests__/GlobalAutocomplete.tablet-edit-persistence.test.tsx` (new)
- `src/components/__tests__/EquipmentTypeCombobox.edit-existing.test.tsx` (new)

## Verification

- `bunx vitest run src/components/__tests__/GlobalAutocomplete.dropdown-persistence.test.tsx src/components/__tests__/GlobalAutocomplete.tablet-edit-persistence.test.tsx src/components/__tests__/EquipmentTypeCombobox.edit-existing.test.tsx`
- Manual: in the preview, open an existing inspection's Operating Systems table on a narrow viewport, tap a system-type cell with text, type one extra character, tap outside → text now reads original + new character.
- Manual: same on Equipment table.
- Manual: on a populated inspector-name field, focus → blur → focus → type → text still survives.
