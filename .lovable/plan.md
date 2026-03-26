

## Fix: Text Selection in CommandInput (Autocomplete Search Box)

### Problem
When clicking into an autocomplete field (e.g., equipment name "Bouldering Wall"), the popover opens and the `CommandInput` search box inside it receives the current value with **all text highlighted**. This is because `CommandInput` (from cmdk) lacks the `placeCursorAtEnd` protection already applied to `Input` and `Textarea`.

### Root Cause
`src/components/ui/command.tsx` — The `CommandInput` component (lines 38-53) renders a raw `CommandPrimitive.Input` with no `onFocus`, `onMouseUp`, or `onTouchEnd` handlers. When the popover opens and the cmdk input auto-focuses with a pre-filled value, the browser selects all text by default.

### Fix
**File: `src/components/ui/command.tsx`** (lines 38-53)

Add the same multi-stage `placeCursorAtEnd` and `collapseFullSelection` logic used in `Input` and `Textarea`:

1. Add a `placeCursorAtEnd` helper that calls `setSelectionRange(len, len)` across three frames (immediate + rAF + setTimeout).
2. Add a `collapseFullSelection` helper that detects full-text selection and collapses it.
3. Wire `onFocus`, `onMouseUp`, and `onTouchEnd` on `CommandPrimitive.Input`, merging with any consumer-provided handlers via `...props`.

This single change fixes all autocomplete components (`GlobalAutocomplete`, `DatabaseAutocomplete`, `OrganizationAutocomplete`, `HistoryAutocomplete`) since they all use `CommandInput`.

### Files to Modify

| File | Change |
|------|--------|
| `src/components/ui/command.tsx` | Add cursor-at-end handlers to `CommandInput` |

