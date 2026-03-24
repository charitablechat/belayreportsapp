

## Tab Navigation Across Report Form Fields

### Problem
When pressing Tab in report forms, focus doesn't move to the next column as expected because:
1. **TipTap rich text editors** capture Tab for indentation instead of letting it move focus to the next field
2. **LazyRichTextEditor placeholder divs** lack `tabIndex`, so Tab skips over them entirely

### Solution

Make Tab move focus to the next field (right/next column) across all report forms by:

1. **RichTextEditor**: Add a TipTap keyboard shortcut that intercepts Tab and moves focus to the next focusable element in the DOM instead of indenting
2. **LazyRichTextEditor**: Add `tabIndex={0}` to the placeholder div so it participates in tab order, and add a `onKeyDown` handler to activate it on Tab (focus in, then let Tab continue naturally)

### Files Changed

| File | Change |
|------|--------|
| `src/components/ui/rich-text-editor.tsx` | Add `addKeyboardShortcuts` to TipTap config that intercepts `Tab` and `Shift-Tab`, blurs the editor, and programmatically moves focus to the next/previous focusable element |
| `src/components/ui/lazy-rich-text-editor.tsx` | Add `tabIndex={0}` and `onFocus` handler to placeholder div so Tab can land on it; on focus, activate the editor |

### Technical Detail

**rich-text-editor.tsx — Tab handling in TipTap:**
```typescript
StarterKit.configure({
  // ...existing config
}),
// Add extension to handle Tab
Extension.create({
  name: 'tabHandler',
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        // Move focus to next focusable element
        const el = this.editor.view.dom;
        el.blur();
        // Find next focusable and focus it
        const focusables = Array.from(
          document.querySelectorAll<HTMLElement>(
            'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), button:not([disabled]), [contenteditable="true"]'
          )
        ).filter(e => e.offsetParent !== null);
        const idx = focusables.indexOf(el);
        if (idx >= 0 && idx < focusables.length - 1) {
          focusables[idx + 1].focus();
        }
        return true; // prevent default Tab behavior
      },
      'Shift-Tab': () => {
        // Similar but move to previous element
        return true;
      },
    };
  },
}),
```

**lazy-rich-text-editor.tsx — make placeholder focusable:**
```tsx
<div
  tabIndex={0}
  onFocus={() => setIsFocused(true)}
  onClick={() => setIsFocused(true)}
  // ...rest unchanged
>
```

This ensures Tab moves right across columns in all tables (Operating Systems, Ziplines, Equipment) and header fields across all three report types.

