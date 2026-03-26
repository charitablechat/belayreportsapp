

## Fix: Focus Centering & Enter Navigation Consistency

### Problems Found

1. **GlobalAutocomplete bypasses `focusNextCell`**: When Enter is pressed in a `GlobalAutocomplete` field (used for Element Name, Equipment Type, etc.), `handleTriggerKeyDown` calls `triggerInputRef.current?.blur()` — this drops focus entirely instead of moving it to the next column. The `focusNextCell` utility is never invoked.

2. **`placeCursorAtEnd` missing 50ms fallback**: The base `Input` and `Textarea` components use a 3-stage timing strategy (immediate → `requestAnimationFrame` → `setTimeout(0)`), but `CommandInput` adds a critical 4th stage (`setTimeout(setCaret, 50)`) needed for libraries like `cmdk` that override value state after focus. The base components are missing this, causing selection to persist in some scenarios.

3. **`DebouncedInput` also missing 50ms fallback**: It has its own `placeCursorAtEnd` implementation that copies the 3-stage pattern but lacks the 50ms delay.

### Changes

**File: `src/components/ui/input.tsx`**
- Add `setTimeout(setCaret, 50)` to `placeCursorAtEnd` (matching `CommandInput`)

**File: `src/components/ui/textarea.tsx`**
- Add `setTimeout(setCaret, 50)` to `placeCursorAtEnd`

**File: `src/components/inspection/DebouncedInput.tsx`**
- Add `setTimeout(setCaret, 50)` to its local `placeCursorAtEnd`

**File: `src/components/GlobalAutocomplete.tsx`**
- Import `focusNextCell` from `@/lib/table-focus-utils`
- In `handleTriggerKeyDown` (line 348-361): after `handleSelect`, instead of calling `triggerInputRef.current?.blur()`, call `focusNextCell(triggerInputRef.current)` to move focus to the next column
- Add `placeCursorAtEnd` 50ms delay for consistency

**File: `src/lib/table-focus-utils.ts`**
- No changes needed — already scrolls to center and handles row wrapping correctly

