

## Fix: Text Still Highlighted in CommandInput on Popover Open

### Root Cause

The `CommandInput` in `command.tsx` now has `placeCursorAtEnd` on `onFocus`, but cmdk's `CommandPrimitive.Input` internally manages value state. When the autocomplete popover opens, the sequence is:

1. `onFocus` fires → our `placeCursorAtEnd` runs (immediate + rAF + setTimeout(0))
2. cmdk internally sets/updates the input value **after** focus
3. The browser re-selects all text due to the programmatic value update

Our current delays (rAF and `setTimeout(0)`) both resolve **before** cmdk finishes its internal state update, so the selection gets overridden.

### Fix

**File: `src/components/ui/command.tsx`**

Add an additional delayed `setTimeout` (50ms) to `placeCursorAtEnd` specifically for `CommandInput`. This ensures the caret reset fires **after** cmdk's internal value-setting completes:

```typescript
const placeCursorAtEnd = (el: HTMLInputElement) => {
  const setCaret = () => {
    const len = el.value.length;
    el.setSelectionRange(len, len);
  };
  setCaret();
  requestAnimationFrame(setCaret);
  setTimeout(setCaret, 0);
  setTimeout(setCaret, 50);  // catch cmdk's deferred value update
};
```

The extra 50ms timeout is harmless (it's a no-op if the caret is already correct) and ensures we always win the race against cmdk's internal scheduling.

### Files to Modify

| File | Change |
|------|--------|
| `src/components/ui/command.tsx` | Add 50ms setTimeout to `placeCursorAtEnd` |

