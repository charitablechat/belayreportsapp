
## Fix: Return to useSortable with Transforms Enabled

### Why Everything Has Failed So Far

Every attempt has either:
1. Used `useSortable` but **disabled transforms** (set to undefined) -- breaking collision detection
2. Used `useDraggable`+`useDroppable` -- which has no sorting transform layer at all, so items never shift and collision detection sees stale rects

The working `DraggablePhotoItem` + `PhotoGallery` pattern succeeds because it uses `useSortable` with **transforms ENABLED** via `CSS.Transform.toString(transform)`. This is the key: dnd-kit's sorting system needs to apply transforms to shift items during drag so its internal rect tracking stays accurate.

### The Solution

Rewrite `DraggableTableRow` to mirror `DraggablePhotoItem` exactly, and re-add `SortableContext` to all three table components.

### File 1: `DraggableTableRow.tsx` -- Full Rewrite

Switch from `useDraggable`/`useDroppable` back to `useSortable`, matching the `DraggablePhotoItem` pattern:

```typescript
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

// DraggableTableRow
const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id });

const style = {
  transform: CSS.Transform.toString(transform),  // KEY: transforms ENABLED
  transition: transition || 'transform 200ms ease',
  opacity: isDragging ? 0.3 : 1,
  zIndex: isDragging ? 50 : 'auto' as const,
};

// Render with ref={setNodeRef} style={style}
// Show insertion indicator when isOver && !isDragging
// Grip handle uses {...attributes} {...listeners} directly (no separate drag ref)
```

Same pattern for `DraggableMobileCard`.

### Files 2-4: Table Components (OperatingSystems, Ziplines, Equipment)

Re-add `SortableContext` with `verticalListSortingStrategy`:

```typescript
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

// Remove custom collisionDetection (use default closestCenter from SortableContext)
// Remove CollisionDetection import and pointerWithin import

// Wrap rows:
<SortableContext items={systems.map(s => s.id)} strategy={verticalListSortingStrategy}>
  {systems.map((system) => (
    <DraggableTableRow key={system.id} id={system.id} ... />
  ))}
</SortableContext>
```

The collision detection import (`pointerWithin`) and custom `collisionDetection` callback are removed entirely -- `SortableContext` with `verticalListSortingStrategy` handles this internally and correctly.

### Why This Will Work

This is not another experiment. This is copying the exact pattern that already works in `PhotoGallery`:
- `SortableContext` provides the sorting context with proper rect tracking
- `useSortable` with transforms **enabled** means items visually shift to make space
- `CSS.Transform.toString(transform)` applies the shift transforms
- `isOver` from `useSortable` fires reliably because the sorting layer tracks rects correctly
- `DragOverlay` provides the cursor-following ghost (already working)

### Changes Summary

| File | Change |
|------|--------|
| `DraggableTableRow.tsx` | Replace `useDraggable`/`useDroppable` with `useSortable` + `CSS.Transform`. Apply transform+transition style. Use `isOver` from `useSortable` for indicator. Single `setNodeRef` on container. |
| `OperatingSystemsTable.tsx` | Add `SortableContext` + `verticalListSortingStrategy`. Remove `pointerWithin`, `CollisionDetection` type, and custom collision callback. |
| `ZiplinesTable.tsx` | Same as OperatingSystems. |
| `EquipmentTable.tsx` | Same as OperatingSystems. |

### Data Safety

Zero risk. `handleDragEnd`, `arrayMove`, `onUpdate` callbacks are completely untouched.
