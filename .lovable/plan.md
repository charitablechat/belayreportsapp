

## Prevent Default Text Selection on Focus

### Problem
When tapping/clicking into editable fields across report forms, some browsers (especially iPad Safari) auto-select all text. The `DebouncedInput` and autocomplete components already have a multi-stage caret reset strategy, but many other input components used throughout the app lack this protection.

### Affected Components (No Focus Selection Prevention)
1. **`src/components/ui/input.tsx`** — Base `Input` used everywhere
2. **`src/components/ui/textarea.tsx`** — Base `Textarea`
3. **`src/components/ui/voice-input.tsx`** — Wraps `Input`, no `onFocus` handler
4. **`src/components/ui/voice-textarea.tsx`** — Wraps `Textarea`, no `onFocus` handler
5. **`src/components/ui/voice-name-input.tsx`** — Wraps `Input`, no `onFocus` handler
6. **`src/components/ui/voice-name-textarea.tsx`** — Wraps `Input`, no `onFocus` handler
7. **`src/components/PhotoCaptionInput.tsx`** — Direct `Input` with no focus handling
8. **`src/components/daily-assessment/SectionComments.tsx`** — Direct `Textarea`
9. **`src/components/daily-assessment/OperatingSystemsSection.tsx`** — Direct `Input` for custom OS descriptions
10. **`src/components/training/OperatingSystemsSection.tsx`** — Direct `Input` for custom OS descriptions

### Approach
Apply the cursor-at-end logic at the **base component level** (`Input` and `Textarea`) so every consumer automatically gets the fix. This is the most maintainable approach — one change covers all current and future uses.

### Changes

**1. `src/components/ui/input.tsx`**
- Add an `onFocus` handler that calls `setSelectionRange(len, len)` using the same multi-stage strategy (immediate + `requestAnimationFrame` + `setTimeout`) proven in `DebouncedInput`.
- Add `onMouseUp`/`onTouchEnd` handlers that collapse full-text selections to cursor-at-end.
- Merge with any consumer-provided `onFocus`/`onMouseUp`/`onTouchEnd` props.

**2. `src/components/ui/textarea.tsx`**
- Same treatment as `Input`: add `onFocus`, `onMouseUp`, `onTouchEnd` handlers with the multi-stage caret reset.

### Technical Detail
```typescript
// Shared logic for both Input and Textarea
const placeCursorAtEnd = (el: HTMLInputElement | HTMLTextAreaElement) => {
  const setCaret = () => {
    const len = el.value.length;
    el.setSelectionRange(len, len);
  };
  setCaret();
  requestAnimationFrame(setCaret);
  setTimeout(setCaret, 0);
};
```

This ensures all editable fields — `VoiceInput`, `VoiceTextarea`, `VoiceNameInput`, `PhotoCaptionInput`, `SectionComments`, OS description inputs, and any future consumers — inherit the behavior without individual changes.

