

# Fix: Single-Click Instant Focus for LazyRichTextEditor

## Problem

The `LazyRichTextEditor` component implements a two-phase interaction:
1. **Click 1**: Swaps the static HTML preview for the full TipTap editor
2. **Click 2**: Places the cursor inside the editor to begin typing

This creates a frustrating "double-click to edit" experience, especially on mobile during data entry.

## Root Cause

The `RichTextEditor` (TipTap) does not set `autofocus: true` in its editor configuration. When `LazyRichTextEditor` mounts TipTap after the first click, the editor appears but the cursor is not placed.

## Fix

Add `autofocus: true` as a prop/option to `RichTextEditor` that `LazyRichTextEditor` can activate. This is a single property addition to TipTap's `useEditor` config.

### File 1: `src/components/ui/rich-text-editor.tsx`

Add an optional `autoFocus` prop. When true, pass `autofocus: true` to TipTap's `useEditor`:

```typescript
interface RichTextEditorProps {
  // ...existing props
  autoFocus?: boolean;
}

const editor = useEditor({
  // ...existing config
  autofocus: autoFocus ?? false,
});
```

### File 2: `src/components/ui/lazy-rich-text-editor.tsx`

Pass `autoFocus={true}` to `RichTextEditor` when mounting it after the user's click:

```typescript
<RichTextEditor
  content={content}
  onChange={onChange}
  onBlur={...}
  placeholder={placeholder}
  className={className}
  autoFocus={true}
/>
```

## Scope and Safety

- **Two files changed**: `rich-text-editor.tsx` (add prop), `lazy-rich-text-editor.tsx` (pass prop)
- **Zero impact on data**: No state management, save logic, debounce timers, or sync behavior is modified
- **No impact on non-lazy editors**: The `autoFocus` prop defaults to `false`, so `VoiceRichTextEditor` and any direct `RichTextEditor` usage is unaffected
- **No impact on `useBlocker`**: Focus changes do not trigger unsaved-changes detection

