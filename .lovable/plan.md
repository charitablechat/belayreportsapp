

## Fix: Replace @dnd-kit/sortable with @dnd-kit/core only

### Root Cause
`useSortable` from `@dnd-kit/sortable` bundles sorting transforms + collision detection together. You can't disable transforms without also breaking `isOver` and collision detection. This is why every attempt has failed — they're architecturally coupled.

### Solution
Use `@dnd-kit/core` primitives directly:
- `useDraggable` on the grip handle -- provides dragging without any transform on the row
- `useDroppable` on each row -- provides `isOver` independently of any sorting strategy
- `DragOverlay` follows cursor naturally (no snapping)
- No `SortableContext` or `verticalListSortingStrategy` needed

### File 1: `DraggableTableRow.tsx` -- Rewrite

Replace `useSortable` with separate `useDraggable` + `useDroppable`:

```typescript
import { useDraggable, useDroppable } from "@dnd-kit/core";

// DraggableTableRow
const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id });
const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id });

// No transform, no transition on the row -- rows stay completely static
// isOver comes from useDroppable (works independently of sorting strategy)
// Drag handle ref goes on the grip icon only
// Droppable ref goes on the row container
```

Key differences from previous attempts:
- `useDroppable` provides `isOver` without needing sorting transforms
- `useDraggable` only tracks the drag start/end, no transform applied to the source row
- The grip handle uses `setDragRef` + `listeners` + `attributes`
- The row container uses `setDroppableRef`
- Opacity set to 0.15 when dragging (source row fades)

### Files 2-4: Table Components (OperatingSystems, Ziplines, Equipment)

- Remove `SortableContext` and `verticalListSortingStrategy` imports
- Remove `<SortableContext>` wrapper around rows
- Add `closestCenter` import from `@dnd-kit/core` and pass as `collisionDetection` prop to `DndContext`
- Keep `DragOverlay`, `handleDragStart`, `handleDragEnd`, `arrayMove` exactly as they are

```typescript
// Before
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

// After
import { arrayMove } from "@dnd-kit/sortable";  // only for the arrayMove utility
import { closestCenter } from "@dnd-kit/core";   // add to existing core import

// DndContext gets collisionDetection prop
<DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={...} onDragEnd={...}>
  {/* No SortableContext wrapper needed */}
  {systems.map((system) => (
    <DraggableTableRow key={system.id} id={system.id} ... />
  ))}
</DndContext>
```

### Why This Will Work

This pattern separates the three concerns that `useSortable` bundles together:
1. **Dragging** (`useDraggable`) -- only tracks grab/release, no row transforms
2. **Drop targeting** (`useDroppable`) -- provides `isOver` based on pointer proximity to element rects (no transforms needed)
3. **Visual feedback** (`DragOverlay`) -- follows cursor independently (already working)

Since no transforms are applied to ANY rows, collision detection uses the actual static DOM rects, which are always accurate. `isOver` fires reliably. `DragOverlay` follows the cursor without snapping.

### Changes Summary

| File | Change |
|------|--------|
| `DraggableTableRow.tsx` | Replace `useSortable` with `useDraggable` + `useDroppable`. Drag ref on grip, droppable ref on container. No transforms. |
| `OperatingSystemsTable.tsx` | Remove `SortableContext` wrapper. Add `closestCenter` to `DndContext`. Keep `arrayMove` import. |
| `ZiplinesTable.tsx` | Same changes as OperatingSystems. |
| `EquipmentTable.tsx` | Same changes as OperatingSystems. |

### Data Safety
Zero changes to `handleDragEnd`, `arrayMove`, `onUpdate`, or any mutation logic. The `active.id` and `over.id` values passed to `handleDragEnd` come from `DndContext` collision detection, which works the same way with `closestCenter` + `useDroppable`.

