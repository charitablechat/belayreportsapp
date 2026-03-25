

## Fix: Color Split in Comments Column Rich Text Editor

### Root Cause

The `RichTextEditor` component (line 86-87 of `rich-text-editor.tsx`) has:
```tsx
<div className={cn('border rounded-md bg-background', className)}>
  <div className="flex items-center gap-1 p-2 border-b bg-muted/50">
```

When used inside table cells with `className="border-0 bg-transparent"`:
- The outer div becomes `border-0 bg-transparent` (tailwind-merge works correctly)
- But the **toolbar div** keeps its hardcoded `border-b bg-muted/50`
- The semi-transparent `bg-muted/50` composites differently over the transparent outer div vs the row's `bg-background`
- The `border-b` adds a visible horizontal line
- The `rounded-md` on the outer container creates subtle curved edges visible against the cell background

This combination produces the visible color discontinuity on iPad displays.

### Fix

**1. `src/components/ui/rich-text-editor.tsx` — Make toolbar respect transparent context**

When `className` contains `bg-transparent`, the toolbar should also be transparent-friendly. Simplest approach: change the toolbar to use `bg-muted/30` (lighter) and remove `border-b` when in transparent mode.

Better approach: accept a `variant` or detect `bg-transparent` in className and conditionally strip the toolbar styling:

```typescript
const isInline = className?.includes('bg-transparent');

// Outer div — existing cn() logic, already works
<div className={cn('border rounded-md bg-background', className)}>
  // Toolbar — strip border-b and bg when inline
  <div className={cn(
    "flex items-center gap-1 p-2",
    !isInline && "border-b bg-muted/50"
  )}>
```

This removes the toolbar's background and bottom border when the editor is embedded inline in a table cell, eliminating the color split.

**2. `src/components/ui/rich-text-editor.tsx` — Remove `rounded-md` in inline mode**

The `rounded-md` on the outer div creates visible curved corners inside a rectangular grid cell. Strip it in inline mode:

```typescript
<div className={cn(
  'border bg-background',
  !isInline && 'rounded-md',
  className
)}>
```

### Files
| File | Change |
|------|--------|
| `src/components/ui/rich-text-editor.tsx` | Detect inline/transparent usage; conditionally strip toolbar `border-b`, `bg-muted/50`, and outer `rounded-md` |

### Impact
- Only affects editors rendered with `bg-transparent` class (table cells)
- Standalone editors (e.g., summary sections) keep their current bordered appearance
- No changes to text wrapping logic

