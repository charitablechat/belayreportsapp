

## Architectural Redesign: Replace useSortable with useDraggable + useDroppable

### Why Previous Fixes Failed

Every attempt so far has tried to work around `useSortable` -- disabling its transforms, overriding its collision, fighting its rect calculations. The core problem is that `useSortable` is designed to **visually shift items to make space** during drag. When you disable that (set transform to undefined), its internal rect tracking becomes stale. It still reports the active item's original rect, making collision detection unreliable for tall, variable-height rows.

The session replay confirms: the DragOverlay tracks the cursor smoothly (`translate3d(277px, 119px, 0px)` progressing frame-by-frame), but drops still resolve incorrectly because `useSortable`'s internal coordinate system is broken when transforms are disabled.

### The Fix: Drop useSortable Entirely

Replace `useSortable` with the lower-level `useDraggable` + `useDroppable` hooks from `@dnd-kit/core`. These hooks give direct control with zero sorting transform logic.

```text
Current flow (broken):
  useSortable -> transform (disabled) -> stale rects -> bad collision

New flow (clean):
  useDraggable (grip handle) -> DragOverlay (ghost)
  useDroppable (row container) -> live rects -> accurate collision
```

### Changes

**File 1: `src/components/inspection/DraggableTableRow.tsx`** (full rewrite)

Replace `useSortable` with:
- `useDraggable({ id })` on the grip handle -- provides `listeners`, `attributes`, `setActivatorNodeRef`
- `useDroppable({ id })` on the row container -- provides `setNodeRef`, `isOver`
- `isOver` from `useDroppable` replaces the manual `overId` state tracking
- No transforms applied to rows at all -- they stay in DOM position permanently
- The `isDropTarget` prop is replaced by `useDroppable`'s built-in `isOver`
- Insertion line indicator rendered when `isOver && !isDragging`

**File 2: `src/components/inspection/OperatingSystemsTable.tsx`**

- Remove `SortableContext` and `verticalListSortingStrategy` imports
- Remove `overId` state and `onDragOver` handler (no longer needed -- `useDroppable` handles this internally)
- Remove `isDropTarget` prop from row components (handled internally now)
- Keep: `DndContext`, sensors, collision detection, `DragOverlay`, `arrayMove`, `handleDragEnd`

**File 3: `src/components/inspection/ZiplinesTable.tsx`**

Same changes as OperatingSystemsTable.

**File 4: `src/components/inspection/EquipmentTable.tsx`**

Same changes as OperatingSystemsTable.

### Technical Details

**DraggableTableRow (new implementation sketch):**
```text
import { useDraggable, useDroppable } from "@dnd-kit/core";

function DraggableTableRow({ id, children, gridCols }) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });

  return (
    <div ref={setDropRef} style={{ opacity: isDragging ? 0.15 : 1 }}
         className={`relative grid ${gridCols} ...`}>
      {isOver && !isDragging && (
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary ..." />
      )}
      <div className="p-2 flex items-center justify-center border-r">
        <div ref={setDragRef} {...attributes} {...listeners}
             className="cursor-grab active:cursor-grabbing touch-none">
          <GripVertical />
        </div>
      </div>
      {children}
    </div>
  );
}
```

**Table component cleanup (per file):**
```text
// REMOVE these:
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
const [overId, setOverId] = useState(null);
onDragOver={(e) => setOverId(...)}
<SortableContext items={ids} strategy={verticalListSortingStrategy}>

// KEEP these (unchanged):
import { DndContext, closestCenter, DragOverlay, ... } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";  // arrayMove is still useful
collisionDetection (exclude active item)
handleDragEnd with arrayMove
DragOverlay with ghost content
```

### Why This Will Work

1. `useDroppable` tracks its own rect independently -- no stale transform math
2. `useDroppable.isOver` is computed directly from pointer position vs. droppable rect -- no intermediate sorting layer
3. The collision detection (closestCenter excluding active) works correctly against real DOM rects since no transforms are applied
4. `useDraggable` only provides drag activation on the grip handle -- clean separation of concerns
5. The DragOverlay already tracks the cursor perfectly (confirmed by session replay)

### Data Safety

Zero risk. `arrayMove` in `handleDragEnd` is identical. `onUpdate` callbacks unchanged. Only the hook layer changes from `useSortable` to `useDraggable`/`useDroppable`.

