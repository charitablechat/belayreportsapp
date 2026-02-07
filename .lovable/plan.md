

# Inline-Editable Autocomplete Fields - v2.4.18

## Problem

All autocomplete/autofill components display selected values as static text inside a Button. To change a value, users must open the dropdown and completely retype. There is no way to:
- Edit a character in the middle of the selected text
- Use backspace to partially clear the value
- Clear the field with an X button without opening the dropdown

## Components That Need This Change

| Component | Used For | Needs Change? |
|-----------|----------|--------------|
| **GlobalAutocomplete** | Equipment type, zipline name, braking system, cable type, operating system element | Yes |
| **OrganizationAutocomplete** | Training site / organization name | Yes |
| **DatabaseAutocomplete** | Inspector name, onsite contact, trainer name | Yes |
| **HistoryAutocomplete** | Generic history-backed fields | Yes |
| ResultSelect | Pass/Fail/Provisions (fixed options) | No |
| SystemTypeSelect | System type (fixed + custom options) | No |

## Solution

Replace the `<Button>` popover trigger with a styled `<Input>` that:
1. Displays the current value as editable text
2. Opens the suggestion dropdown on focus/click
3. Filters suggestions as the user types
4. Includes a clear (X) button when a value is present
5. Commits the typed value on blur or Enter
6. Retains the chevron icon for dropdown affordance

## Technical Details

### Pattern Applied to All 4 Components

**Before (current):**
```text
+--------------------------------------------+
| Selected Value Text           [chevron v]  |  <-- Button, not editable
+--------------------------------------------+
```

**After (new):**
```text
+--------------------------------------------+
| Selected Value Text       [X]  [chevron v] |  <-- Input, fully editable
+--------------------------------------------+
```

### Shared Behavior

- The Input replaces the Button as the PopoverTrigger
- Typing in the Input opens the popover and filters suggestions
- The X button clears the field value and closes the popover
- Pressing Enter commits the current typed text as the value
- On blur (clicking away), the current input text is committed as the value
- Backspace works naturally since it's a real input field
- The dropdown still opens on click/focus for suggestion browsing

### File: src/components/GlobalAutocomplete.tsx

1. Replace the `<Button>` trigger (lines 257-277) with an `<Input>` wrapped in a div
2. Add state to track whether the input is focused (`isEditing`)
3. When not focused, display `value` in the input. When focused, display/edit `inputValue`
4. On focus: set `inputValue` to current `value`, open popover
5. On blur: commit `inputValue` as the new value (if changed), save to history
6. Add a clear (X) button that calls `onChange("")` and clears `inputValue`
7. Keep the chevron icon for visual consistency

### File: src/components/OrganizationAutocomplete.tsx

Same pattern. Replace Button trigger (lines 222-234) with Input. The search state already exists (`search`), so wire the input value to `search` when focused and to `value` when not.

### File: src/components/DatabaseAutocomplete.tsx

Same pattern. Replace Button trigger (lines 243-254) with Input. Wire to `searchValue` state.

### File: src/components/HistoryAutocomplete.tsx

Same pattern. Replace Button trigger (lines 236-253) with Input. Wire to `inputValue` state.

### Input Styling

The input will be styled to match the existing button appearance:
- `variant="outline"` equivalent: border, rounded corners, same height
- Chevron and X icons positioned absolutely or via flex layout on the right
- Placeholder text uses `text-muted-foreground`
- Disabled state grays out the input

### Event Flow

```text
User clicks input
  -> Input focuses, popover opens
  -> inputValue set to current value
  -> User can type/edit freely
  -> Suggestions filter as they type

User presses Enter
  -> Commit inputValue as value
  -> Save to history
  -> Close popover

User clicks suggestion
  -> Set value to suggestion
  -> Save to history  
  -> Close popover

User clicks X
  -> Clear value to ""
  -> Clear inputValue
  -> Close popover

User clicks away (blur)
  -> Commit inputValue if non-empty
  -> If empty, keep previous value (prevent accidental clearing)
```

### Files Changed

| File | Change |
|------|--------|
| `src/components/GlobalAutocomplete.tsx` | Replace Button trigger with editable Input + clear button |
| `src/components/OrganizationAutocomplete.tsx` | Replace Button trigger with editable Input + clear button |
| `src/components/DatabaseAutocomplete.tsx` | Replace Button trigger with editable Input + clear button |
| `src/components/HistoryAutocomplete.tsx` | Replace Button trigger with editable Input + clear button |
| `vite.config.ts` | Bump to v2.4.18 |

## What Does NOT Change

- ResultSelect (fixed Pass/Fail options -- inline editing not applicable)
- SystemTypeSelect (fixed + custom system types with add/edit dialog -- already has edit capability)
- Suggestion list rendering, history saving, database upsert logic
- Popover content and CommandList structure remain identical
- No database or migration changes needed

