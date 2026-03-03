

## Fix Mobile Touch Drag: Dragged Element Blocking `elementFromPoint`

### Root Cause

The core bug is that `document.elementFromPoint()` during `touchmove` hits the **dragged element itself**, not the row underneath. Here's why:

1. User long-presses grip on Row A -- drag activates, Row A gets `opacity: 0.4`
2. User slides finger down toward Row B
3. `elementFromPoint(touch.clientX, touch.clientY)` fires
4. Row A is still in normal document flow (just visually transparent) -- it still receives hit-testing
5. `closest('[data-drag-id]')` finds Row A
6. Code checks `targetId !== draggedIdRef.current` -- this is FALSE (same element), so it **skips** updating state
7. Drop indicator never appears on any other row

On mobile cards this is especially bad because each card is tall (multiple fields stacked), so the finger stays within the dragged card's bounds for a long movement distance.

Additionally, the browser context menu (visible in the screenshot) can still appear despite `e.preventDefault()` on `touchstart`, because the `contextmenu` event itself is not being intercepted.

### Fix: Two Changes

#### 1. Add `pointer-events: none` to the dragged element during touch drag

This makes `elementFromPoint` "see through" the dragged element to the row underneath. Touch event dispatching is unaffected because touch events follow the original target element, not hit-testing. Desktop drag is also unaffected because it uses `onDragOver` per-element, not `elementFromPoint`.

**Files:** `src/components/inspection/DraggableTableRow.tsx`

For both `DraggableTableRow` and `DraggableMobileCard`, change the inline style from:
```
style={{ opacity: isDragging ? 0.4 : 1 }}
```
to:
```
style={{
  opacity: isDragging ? 0.4 : 1,
  pointerEvents: isTouchDragging ? 'none' : undefined,
}}
```

This uses the existing `isTouchDragging` prop (already passed from `getDragProps`) to only disable pointer-events during touch-initiated drags, preserving desktop behavior.

For `DraggableMobileCard`, `isTouchDragging` is currently not destructured from props -- it needs to be added to the destructuring.

#### 2. Prevent the `contextmenu` event on grip handles

Add an `onContextMenu={(e) => e.preventDefault()}` handler to both grip handle divs to block the browser's long-press context menu that's visible in the screenshot.

**File:** `src/components/inspection/DraggableTableRow.tsx`

On both grip handle `<div>` elements (DraggableTableRow line ~60, DraggableMobileCard line ~127), add:
```
onContextMenu={(e) => e.preventDefault()}
```

### Summary of Changes

| File | Change |
|------|--------|
| `DraggableTableRow.tsx` (DraggableTableRow) | Add `pointerEvents: isTouchDragging ? 'none' : undefined` to row style; add `onContextMenu` to grip |
| `DraggableTableRow.tsx` (DraggableMobileCard) | Destructure `isTouchDragging` from props; add `pointerEvents` to card style; add `onContextMenu` to grip |

No changes needed to `useNativeDrag.tsx` or `EquipmentTable.tsx` -- the `isTouchDragging` prop is already computed and passed correctly.

### Why This Works

```text
Before (broken):
  touchmove -> elementFromPoint -> hits dragged row (opacity 0.4 but still in flow)
  -> targetId === draggedId -> SKIP -> no indicator ever appears

After (fixed):
  touchmove -> elementFromPoint -> dragged row has pointer-events:none, skipped
  -> hits row underneath -> targetId !== draggedId -> state updates -> indicator renders
```

Desktop behavior is completely unaffected: `isTouchDragging` is false on desktop, so `pointer-events` stays at default.

