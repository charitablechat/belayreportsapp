

## Fix Drag-and-Drop: Enable Transforms and Mirror DraggablePhotoItem Pattern

### Current State

`DraggableTableRow.tsx` already uses `useSortable` but **explicitly ignores** the `transform` and `transition` outputs. This is why the ghost offset persists and the drop indicator is unreliable -- without transforms, `@dnd-kit`'s sorting layer cannot visually shift rows to "make room" for the dragged item, and the internal collision tracking doesn't stay in sync with the visual layout.

### Solution

Enable `CSS.Transform.toString(transform)` and `transition` on the row container, exactly as `DraggablePhotoItem.tsx` does. This is the pattern that already works correctly for photo reordering in this same project.

### File 1: `src/components/inspection/DraggableTableRow.tsx`

**DraggableTableRow changes:**
- Import `CSS` from `@dnd-kit/utilities`
- Apply `CSS.Transform.toString(transform)` and `transition` to the row style
- Keep `isDragging` for opacity (0.4) and dashed border on the source row
- Keep `isOver` for the blue insertion line indicator
- Add `position: relative` and `z-index` when dragging to float above siblings

**DraggableMobileCard changes:**
- Same transform/transition enablement
- Same visual feedback (opacity, ring, indicator line)

```text
Key style object:
{
  transform: CSS.Transform.toString(transform),
  transition: transition || 'transform 200ms ease',
  opacity: isDragging ? 0.4 : 1,
  zIndex: isDragging ? 50 : 'auto',
}
```

### Files 2-4: Table Components (no changes needed)

`OperatingSystemsTable.tsx`, `ZiplinesTable.tsx`, and `EquipmentTable.tsx` already have:
- `SortableContext` with `verticalListSortingStrategy` wrapping rows
- `closestCenter` collision detection
- `DragOverlay` with ghost elements
- Correct `handleDragEnd` using `arrayMove`

These files need **no modifications** -- only the shared `DraggableTableRow.tsx` component needs updating.

### Why This Works

1. **Ghost offset fixed**: With transforms enabled, `@dnd-kit` can properly calculate the drag offset relative to the grab point. The `DragOverlay` uses the measured rect of the full row (via `setNodeRef`) to position the ghost correctly under the cursor.

2. **Drop indicator reliable**: `isOver` from `useSortable` works correctly when transforms are enabled because the sorting layer can track which item the pointer is nearest to as rows shift position.

3. **Rows shift smoothly**: Neighboring rows animate out of the way (via CSS transform) to show where the dragged item will land, providing clear spatial feedback alongside the blue line indicator.

4. **Proven pattern**: This mirrors `DraggablePhotoItem.tsx` which uses the identical approach and works correctly in this project.

### Changes Summary

| File | Change |
|------|--------|
| `DraggableTableRow.tsx` | Enable `CSS.Transform.toString(transform)` and `transition` in both `DraggableTableRow` and `DraggableMobileCard`. Add z-index on drag. |
| `OperatingSystemsTable.tsx` | No changes needed. |
| `ZiplinesTable.tsx` | No changes needed. |
| `EquipmentTable.tsx` | No changes needed. |

