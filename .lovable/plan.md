

## Fix: Prevent Text Selection on All Draggable Rows During Touch Drag

### Remaining Problem

All five implementation points are verified as correctly coded. The **remaining failure** visible in the screenshot is that text on *other* cards (the ones being dragged *over*) gets selected during touch movement. The word "Element" is highlighted blue on the target card.

This causes two problems:
1. Browser text selection competes with custom drag handling
2. `elementFromPoint()` may hit selected text overlays instead of the card container

The root cause: `user-select: none` is only applied to the grip handle divs, not to the card/row containers. During a touch drag, the finger slides over other cards' content areas which still have default `user-select: auto`.

### Fix Strategy

Apply `user-select: none` to ALL draggable row/card containers unconditionally (not just during drag). These are interactive data-entry rows — text selection on them is never the desired behavior (inputs handle their own selection). This is a single-file change.

### Changes: `src/components/inspection/DraggableTableRow.tsx`

**DraggableTableRow** — add `userSelect: 'none'` and `WebkitTouchCallout: 'none'` to the container's inline style (the `div` with `ref={rowRef}`):

```typescript
style={{
  opacity: isDragging ? 0.4 : 1,
  pointerEvents: isTouchDragging ? 'none' : undefined,
  userSelect: 'none',
  WebkitTouchCallout: 'none',
} as React.CSSProperties}
```

**DraggableMobileCard** — same change on the container `div` with `ref={cardRef}`:

```typescript
style={{
  opacity: isDragging ? 0.4 : 1,
  pointerEvents: isTouchDragging ? 'none' : undefined,
  userSelect: 'none',
  WebkitTouchCallout: 'none',
} as React.CSSProperties}
```

### Why This Works

- Text selection is disabled on ALL draggable containers (both the dragged one and the ones being dragged over)
- `elementFromPoint()` will cleanly hit the container divs without text selection overlays interfering
- Input fields, textareas, and rich text editors inside the rows handle their own selection independently — `user-select: none` on the container does not prevent typing or selecting within focused inputs
- No other files need changes — `useNativeDrag.tsx`, `EquipmentTable.tsx`, and the table components remain untouched

### Files Changed

| File | Change |
|------|--------|
| `DraggableTableRow.tsx` (DraggableTableRow) | Add `userSelect: 'none'` and `WebkitTouchCallout: 'none'` to container style |
| `DraggableTableRow.tsx` (DraggableMobileCard) | Same two CSS properties on container style |

