

## Comprehensive Drag-and-Drop Fix

### Root Cause Analysis

After thorough investigation, the persistent DnD issues stem from **one architectural problem**: trying to apply visual indicators (`outline`, `box-shadow`, `borderTop`) directly to `<tr>` elements inside a `border-collapse` table wrapped in an `overflow-x-auto` container.

- `box-shadow` on `<tr>`: clipped by `border-collapse`
- `borderTop` on `<tr>`: shifts the table layout, causing row jumps
- `outline` on `<tr>`: renders outside the box but gets clipped by the `overflow-x-auto` wrapper div

No combination of these CSS properties will produce a reliable, visible indicator on table rows. Every "fix" so far has been a variation of the same broken approach.

### Solution: Rendered Indicator Elements

Instead of CSS properties on `<tr>`, render actual DOM elements for the indicators:

**1. Drop indicator bar** -- An absolutely-positioned `<div>` inside the grip `<td>` cell that extends visually across the full row width. This is a real DOM element, not a CSS pseudo-effect, so it cannot be clipped by table layout rules.

**2. Placeholder styling** -- Instead of `outline` on the `<tr>` (which gets clipped), apply a subtle dashed border to each `<td>` inside the dragging row via a CSS class, and reduce the row's background opacity.

**3. DragOverlay cursor attachment** -- Ensure the overlay renders with `position: fixed` (which `DragOverlay` does by default via a portal). No changes needed to overlay content, but add `onDragCancel` handlers to all three tables to prevent stale `activeId` state if a drag is aborted.

---

### File Changes

#### `src/components/inspection/DraggableTableRow.tsx`

**DraggableTableRow (desktop):**
- Remove all `outline`, `outlineOffset`, `background` styles from the `<tr>` `style` prop
- Keep `transform: isDragging ? 'none' : baseTransform` (this part is correct)
- Keep `opacity: isDragging ? 0.15 : 1`
- Inside the grip `<td>`, render a drop indicator `<div>` when `isOver && !isDragging`:
  - Absolutely positioned at `top: 0, left: 0`
  - `height: 4px`, `width: 200vw` (extends beyond cell), `background: hsl(var(--primary))`
  - `boxShadow: 0 0 8px hsl(var(--primary) / 0.5)` for glow
  - `pointerEvents: none`, `zIndex: 50`
- The grip `<td>` gets `style={{ position: 'relative', overflow: 'visible' }}`
- When `isOver && !isDragging`, add a subtle background tint to the `<tr>` via `className` instead of inline style (using a simple conditional class)

**DraggableMobileCard:**
- Same approach: render indicator `<div>` inside the card when `isOver && !isDragging`
- Remove unreliable `outline`/`outlineOffset` styles
- Keep `transform: 'none'` when dragging

#### `src/components/inspection/OperatingSystemsTable.tsx`
- Add `onDragCancel` handler that clears `activeId` (prevents stale overlay on drag abort)

#### `src/components/inspection/ZiplinesTable.tsx`
- Add `onDragCancel` handler that clears `activeId`

#### `src/components/inspection/EquipmentTable.tsx`
- Add `onDragCancel` handler that clears `activeId`

---

### Technical Details

The indicator element approach inside the grip cell:

```text
<tr style={{ transform: isDragging ? 'none' : baseTransform, opacity: isDragging ? 0.15 : 1 }}>
  <td style={{ position: 'relative', overflow: 'visible' }}>
    {isOver && !isDragging && (
      <div style={{
        position: 'absolute',
        top: -1,
        left: -1,
        height: 4,
        width: '200vw',     // extends far beyond cell boundaries
        background: 'hsl(var(--primary))',
        boxShadow: '0 0 8px hsl(var(--primary) / 0.5)',
        zIndex: 50,
        pointerEvents: 'none',
      }} />
    )}
    <GripVertical /> (drag handle)
  </td>
  {children}   (remaining <td> cells)
</tr>
```

This works because:
- The `<div>` is a real DOM element, not a CSS property on `<tr>`
- `overflow: visible` on the parent `<td>` lets the bar extend beyond the cell
- `200vw` width ensures it covers any table width
- The `overflow-x-auto` on the table wrapper clips horizontally at the wrapper edge, which is actually desirable (the bar spans the visible table width)
- `position: absolute` + `zIndex: 50` ensures it paints above adjacent rows

For the mobile card, the same `<div>` indicator works trivially since `<div>` elements have no styling restrictions.

### Why This Will Work

Previous approaches all tried to use CSS properties that are known to fail on `<tr>` in `border-collapse` tables:
- `box-shadow`: clipped by collapsed borders
- `outline`: painted outside the box, clipped by `overflow` containers  
- `borderTop`: shifts layout, causes rows to jump

This approach uses an actual rendered DOM element that is not subject to any of those restrictions. It's the same technique used by professional Kanban boards (Trello, Linear, etc.) where the insertion indicator is always a separate rendered element, never a CSS property on the container.

