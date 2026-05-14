## Finding

The "Element Name" field in `OperatingSystemsTable.tsx` is **already** a Popover + Command combobox (`GlobalAutocomplete`, `fieldType="operating_system_element"`). It opens on focus, filters as you type, lets you select a previous entry, and lets you commit a custom value via Enter or "Create …".

What the user is experiencing is the empty-state: on a fresh device the only sources of suggestions are
1. `historyOptions` from IndexedDB / `global_field_history` (empty for new users), and
2. `existingValues` derived from rows already in the current report (empty until they type one).

So the popover does open, but it shows "No entries found. Type to add new." — which reads as "no dropdown".

## Fix

Seed the `operating_system_element` field with a small set of common defaults so the dropdown is meaningfully populated the first time a user clicks the field, while preserving every existing behavior (custom typing, selecting saves to history, blue focus outline, placeholder unchanged).

### Changes

1. **`src/components/inspection/OperatingSystemsTable.tsx`**
   - Add a module-level constant `DEFAULT_ELEMENT_NAMES = ["Tower", "Two Line Bridge", "Base Station", "Signal Repeater", "Power Module"]`.
   - Merge it into `existingElementNames` (deduped, case-insensitive) before passing to `<GlobalAutocomplete existingValues={…} />`, in both desktop and mobile branches.

That's the entire fix. No other file needs to change:
- `GlobalAutocomplete` already merges `existingValues` into the dropdown list (`mergedOptions`) and already supports click-to-select + free-form typing.
- "Operating System" and "Result" styling parity is already in place — `GlobalAutocomplete` is the same control used by other Element-Name instances; it keeps the blue focus ring and the existing `placeholder="Enter or select name"`.
- Selecting a default writes it to history via `saveToHistory`, so it persists per-user/team going forward exactly like a typed value.

### Out of scope

- No changes to `GlobalAutocomplete.tsx` (current dropdown / focus / commit behavior is correct).
- No DB migration — defaults are client-side seeds; once a user picks one, normal `global_field_history` persistence takes over.
- No changes to other tables (Equipment, Ziplines) — request is scoped to the Element Name field in the system components table.

### Verification

- Open an inspection → Operating Systems → Add System → click Element Name.
- Expect the popover to show "Previous entries" with the five seeded names plus any prior history.
- Typing filters them; pressing Enter on a non-matching string still creates the value; clicking a row commits it and closes the popover.
