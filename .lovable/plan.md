

## Fix DragOverlay Offset and Drop Indicator Reliability

### Root Cause Analysis

**DragOverlay offset (~550px):** The `useDraggable` ref (`setDragRef`) is attached to the small grip handle icon. `DragOverlay` positions itself based on the initial rect of this ref node. Since the grip is a tiny element at the far-left of the row, the overlay renders starting from that position and extends right with `min-w-[400px]`, creating the appearance of a large horizontal offset from the cursor.

**Drop indicator unreliable:** `closestCenter` collision detection targets the geometric center of each droppable row. When rows are tall (rich text editors expand them), the pointer may stay "closest" to one row's center for a large vertical range, making the indicator sluggish to transition between rows.

### Fix 1: Merge draggable + droppable refs onto the row container

Set both refs on the row `<div>` so that `DragOverlay` measures the full row rect (not the tiny grip). Keep drag listeners on the grip handle only (so only the grip activates dragging).

```typescript
// DraggableTableRow - merge refs on the container
import { useCallback } from "react";

const mergedRef = useCallback((node: HTMLDivElement | null) => {
  setDroppableRef(node);
  setDragRef(node);
}, [setDroppableRef, setDragRef]);

// Container div uses mergedRef
<div ref={mergedRef} style={style} className={...}>
  {/* Grip only gets listeners + attributes (no ref) */}
  <div {...attributes} {...listeners} className="cursor-grab ...">
    <GripVertical ... />
  </div>
  {children}
</div>
```

Same pattern for `DraggableMobileCard`.

### Fix 2: Switch collision detection to `pointerWithin`

Replace `closestCenter` with `pointerWithin` in all three table components. `pointerWithin` fires `isOver` when the pointer is inside a droppable's bounding rect -- much more intuitive for vertically stacked rows and eliminates the "dead zone" problem near row boundaries.

```typescript
// In each table component
import { ..., pointerWithin } from "@dnd-kit/core";

<DndContext
  sensors={sensors}
  collisionDetection={pointerWithin}  // was: closestCenter
  onDragStart={handleDragStart}
  onDragEnd={handleDragEnd}
  onDragCancel={() => setActiveId(null)}
>
```

### Files to change

| File | Change |
|------|--------|
| `DraggableTableRow.tsx` | Merge `setDragRef` + `setDroppableRef` via callback ref on container. Move listeners/attributes to grip div only (remove ref from grip). Apply same to `DraggableMobileCard`. |
| `OperatingSystemsTable.tsx` | Replace `closestCenter` with `pointerWithin` import and usage. |
| `ZiplinesTable.tsx` | Same collision detection change. |
| `EquipmentTable.tsx` | Same collision detection change. |

### Why this fixes both issues

1. **Offset**: `DragOverlay` now measures the full row rect, so it renders aligned with the row rather than offset to the grip handle's tiny rect.
2. **Drop indicator**: `pointerWithin` triggers `isOver` as soon as the pointer enters any part of the row, so the blue indicator line appears reliably as you drag between rows.
3. **No data changes**: `handleDragEnd`, `arrayMove`, `onUpdate` logic remains untouched.

