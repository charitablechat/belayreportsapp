

## Fix: LazyRichTextEditor Color Split on iPad

### Root Cause

The `RichTextEditor` itself was already fixed (lines 85-89), but the **`LazyRichTextEditor`** wrapper — which renders most of the time since the editor is lazy — does **not** apply the same inline-mode logic in its unfocused placeholder state.

In `lazy-rich-text-editor.tsx` lines 61-65, the unfocused div always renders:
```
"min-h-[80px] cursor-text rounded-md border bg-background px-3 py-2 text-sm"
"hover:bg-muted/50 transition-colors"
```

When passed `className="border-0 bg-transparent"`, Tailwind merge handles `border-0` and `bg-transparent`, but `rounded-md` and `hover:bg-muted/50` remain — producing visible curved corners and a color flash on hover inside rectangular table cells. On iPad Safari's display rendering, the composited `bg-muted/50` over transparent creates the visible color discontinuity.

### Fix

**File: `src/components/ui/lazy-rich-text-editor.tsx`**

Apply the same `isInline` detection used in `RichTextEditor`:

```tsx
const isInline = className?.includes('bg-transparent');
```

Then in the unfocused placeholder div (lines 61-65), conditionally strip `rounded-md` and `hover:bg-muted/50`:

```tsx
className={cn(
  "min-h-[80px] cursor-text border bg-background px-3 py-2 text-sm transition-colors",
  !isInline && "rounded-md hover:bg-muted/50",
  className
)}
```

This is a single-file, 3-line change.

### Impact
- Only affects editors with `bg-transparent` class (table cell usage)
- Standalone lazy editors keep their existing bordered + rounded appearance
- Matches the fix already applied to `RichTextEditor`

