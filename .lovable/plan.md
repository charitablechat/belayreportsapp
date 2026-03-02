

## Fix Drag-and-Drop: Row Jumping, Missing Drop Indicator, and Cursor Tracking

### Root Causes

**Bug 1 -- Row jumps to top when grabbed:**
The `DraggableTableRow` applies `CSS.Transform.toString(transform)` even when `isDragging` is true. When using `DragOverlay`, the original dragged item should NOT be transformed -- it should stay in place as a ghost/placeholder. Currently, `@dnd-kit` calculates a transform for the active item too, which causes it to visually jump. The fix is to zero out the transform when `isDragging` is true.

**Bug 2 -- Drop indicator (bold line) is invisible:**
The current indicator uses `box-shadow: inset 0 4px 0 0 hsl(var(--primary))` on a `<tr>` element. Table rows have notoriously poor `box-shadow` support across browsers -- the shadow gets clipped by the table's `border-collapse` layout. The fix is to switch to `outline` (which works on `<tr>`) or use a simple `borderTop` which is reliable in collapsed tables.

**Bug 3 -- Overlay feels disconnected:**
The `DragOverlay` content is a small summary pill that doesn't resemble the actual row. Combined with the original row jumping away, it feels like nothing is attached to the cursor.

### Solution

#### 1. `DraggableTableRow.tsx` -- Stop transform on active item + fix indicator

```text
BEFORE:
  transform: isDragging ? `${baseTransform} scale(1.01)` : baseTransform
  boxShadow (inset) for isOver indicator  <-- invisible on <tr>

AFTER:
  transform: isDragging ? 'none' : baseTransform   <-- placeholder stays in place
  borderTop: '4px solid hsl(var(--primary))'        <-- reliable on <tr>
  background: 'hsl(var(--primary) / 0.08)'          <-- tint for drop target
```

Key changes:
- When `isDragging`: set `transform: 'none'` so the placeholder row stays exactly where it was. The `DragOverlay` handles the floating visual.
- When `isOver && !isDragging`: use `borderTop` instead of `box-shadow` for the insertion line. This is reliable across all browsers in collapsed tables.
- Keep the dashed outline and low opacity (0.15) on the placeholder.

#### 2. `DraggableMobileCard` -- Same transform fix

Apply the same `transform: 'none'` when `isDragging` pattern. The mobile card's `box-shadow` indicator actually works (since it's a `<div>`), but we'll also switch to `borderTop` for consistency.

#### 3. All three table DragOverlay content -- no changes needed

The current overlay cards (with GripVertical + name + result badge) are actually fine in design. The real problem was the original row jumping away, making the overlay appear disconnected. Once the placeholder stays in place, the overlay will feel properly "lifted" from that position.

### Files Changed

| File | Change |
|------|--------|
| `src/components/inspection/DraggableTableRow.tsx` | Zero transform when `isDragging`; replace `box-shadow` indicator with `borderTop` for `isOver`; apply same fixes to `DraggableMobileCard` |

Only one file needs to change -- the three table components are already correctly configured with `DragOverlay`, `activeId` tracking, and the Y-axis modifier.

### Technical Details

The critical one-line fix in `DraggableTableRow`:
```typescript
// BEFORE (causes jump):
transform: baseTransform ? (isDragging ? `${baseTransform} scale(1.01)` : baseTransform) : undefined,

// AFTER (placeholder stays put):
transform: isDragging ? 'none' : (baseTransform || undefined),
```

For the drop indicator, replacing unreliable `box-shadow` with reliable `borderTop`:
```typescript
// BEFORE (invisible on <tr> in border-collapse):
boxShadow: isOver && !isDragging
  ? 'inset 0 4px 0 0 hsl(var(--primary)), 0 0 12px -2px hsl(var(--primary) / 0.35)'
  : 'none',

// AFTER (works everywhere):
borderTop: isOver && !isDragging ? '4px solid hsl(var(--primary))' : undefined,
background: isDragging ? 'hsl(var(--muted) / 0.5)' : isOver && !isDragging ? 'hsl(var(--primary) / 0.08)' : undefined,
```

