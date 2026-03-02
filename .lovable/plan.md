

## Fix Drag-and-Drop: Ghost Offset and Drop Indicator

### Root Cause

The current implementation uses separate `useDraggable` + `useDroppable` hooks, which fragments the node measurement. `DragOverlay` calculates its position from the draggable node's rect. When that ref is on a tiny grip icon, the offset math breaks -- the overlay renders hundreds of pixels from the cursor. Meanwhile, `useDroppable` combined with `pointerWithin` collision detection isn't reliably triggering `isOver` because collision detection and droppable registration are loosely coupled without `SortableContext`.

### Solution: Return to `useSortable` with Zeroed Transforms

Use `useSortable` from `@dnd-kit/sortable` which bundles draggable + droppable into a single coordinated hook. The key insight the previous attempts missed: you CAN zero out the CSS transforms while keeping `isOver` working, because `isOver` is driven by collision detection against actual DOM rects, not by transform values.

- `setNodeRef` on the row container (full-width measurement for DragOverlay positioning)
- `listeners` + `attributes` on the grip handle only (handle-activated dragging)
- `transform: undefined, transition: undefined` in style (rows stay static)
- `isOver` from `useSortable` provides reliable drop indicator state
- `DragOverlay` with `dropAnimation` for the floating ghost

### File 1: `DraggableTableRow.tsx` -- Rewrite

Replace `useDraggable` + `useDroppable` with `useSortable`:

```typescript
import { useSortable } from "@dnd-kit/sortable";

export function DraggableTableRow({ id, children, className, gridCols }) {
  const { attributes, listeners, setNodeRef, isDragging, isOver } = useSortable({ id });

  // CRITICAL: No transform, no transition -- rows stay perfectly static
  const style = {
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={`relative grid ${gridCols} ...`}>
      {isOver && !isDragging && (
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary z-50 ..." />
      )}
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing ...">
        <GripVertical />
      </div>
      {children}
    </div>
  );
}
```

Same for `DraggableMobileCard` -- use `useSortable`, zero transforms, `isOver` for indicator.

Remove the `isOver` prop from both components (it's now internal from `useSortable`).

### Files 2-4: Table Components

Restore `SortableContext` + `verticalListSortingStrategy` wrapping around rows. Use `closestCenter` collision detection (more reliable than `pointerWithin` when paired with `SortableContext`).

Remove `overId` state and `handleDragOver` since `isOver` is now handled inside each row.

```typescript
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { closestCenter } from "@dnd-kit/core";

<DndContext
  sensors={sensors}
  collisionDetection={closestCenter}
  onDragStart={handleDragStart}
  onDragEnd={handleDragEnd}
  onDragCancel={() => setActiveId(null)}
>
  <SortableContext items={systems.map(s => s.id)} strategy={verticalListSortingStrategy}>
    {systems.map((system) => (
      <DraggableTableRow key={system.id} id={system.id} gridCols={OS_GRID_COLS}>
        ...
      </DraggableTableRow>
    ))}
  </SortableContext>
  <DragOverlay dropAnimation={{ duration: 200, easing: '...' }}>
    {activeSystem ? (...ghost element...) : null}
  </DragOverlay>
</DndContext>
```

### Changes Summary

| File | Change |
|------|--------|
| `DraggableTableRow.tsx` | Replace `useDraggable`+`useDroppable` with `useSortable`. Zero transforms. Internal `isOver` for drop line. Remove `isOver` prop. |
| `OperatingSystemsTable.tsx` | Add `SortableContext` wrapper. Use `closestCenter`. Remove `overId` state and `handleDragOver`. Remove `isOver` prop from rows. |
| `ZiplinesTable.tsx` | Same changes as OperatingSystems. |
| `EquipmentTable.tsx` | Same changes as OperatingSystems (using `categoryEquipment` IDs for SortableContext items). |

### Why This Fixes All Issues

1. **Ghost offset**: `useSortable`'s `setNodeRef` goes on the full row. DragOverlay measures the row's rect and computes the initial grab offset (cursor minus row top-left), so the ghost stays pinned to where you grabbed.
2. **Drop indicator**: `isOver` from `useSortable` is driven by `closestCenter` collision detection against row rects registered through `SortableContext`. No external state management needed -- each row knows when it's the drop target.
3. **Rows stay static**: Explicitly setting no transform/transition means rows never jump or shift during drag. Only the DragOverlay moves.
4. **Visual feedback**: Source row at 0.4 opacity with dashed border. Ghost has shadow + ring. Grip has grab/grabbing cursors.

### Why Previous `useSortable` Attempt Failed

The earlier attempt used `CSS.Transform.toString(transform)` which applied sorting transforms to rows, causing them to jump. This plan explicitly ignores the transform output from `useSortable`, using the hook only for `isOver`, `isDragging`, ref registration, and listener forwarding.

