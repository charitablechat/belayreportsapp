

## Fix Drop Indicator Visibility and DragOverlay Positioning

### Problem 1: Drop indicator never appears
The `isOver` from individual `useDroppable` hooks inside each row isn't reliably triggered. This is because `pointerWithin` collision detection fires at the `DndContext` level, but the individual `useDroppable` hooks may not receive `isOver=true` consistently when the `DragOverlay` portal sits above the rows.

**Fix:** Track the "over" item ID centrally using `DndContext`'s `onDragOver` event in each table component. Pass the `overId` as a prop to `DraggableTableRow` instead of relying on `useDroppable`'s `isOver`.

### Problem 2: DragOverlay offset from cursor
The draggable ref is on the full-width row container. When the user grabs the small grip handle, `DragOverlay` calculates the initial offset from the top-left of the entire row, causing the overlay to appear shifted.

**Fix:** Remove `setDragRef` from the merged container ref and instead put it back on the grip handle div only. Keep `setDroppableRef` on the container. This way the DragOverlay measures position from the grip handle (which is where the user clicks), but collision detection still uses the full row rect.

---

### File 1: `DraggableTableRow.tsx`

**Changes:**
- Remove `useDroppable` entirely -- the drop indicator will be driven by a prop instead
- Split refs back: `setDragRef` goes on the grip handle, `setDroppableRef` stays on the container
- Add `isOver` as a boolean prop passed from the parent table
- Keep `useDraggable` for dragging behavior

```typescript
// Before: merged ref, useDroppable for isOver
const mergedRef = useCallback(...);
const { isOver } = useDroppable({ id });

// After: droppable ref on container, drag ref on grip, isOver from prop
interface DraggableTableRowProps {
  id: string;
  children: ReactNode;
  className?: string;
  gridCols: string;
  isOver?: boolean;  // NEW - passed from parent
}

export function DraggableTableRow({ id, children, className, gridCols, isOver }: ...) {
  const { setNodeRef: setDroppableRef } = useDroppable({ id });
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id });

  return (
    <div ref={setDroppableRef} style={...} className={...}>
      {isOver && !isDragging && (
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary ..." />
      )}
      <div ref={setDragRef} {...attributes} {...listeners} className="cursor-grab ...">
        <GripVertical />
      </div>
      {children}
    </div>
  );
}
```

Same pattern for `DraggableMobileCard` -- add `isOver` prop, remove internal `useDroppable` isOver usage, put `setDragRef` on grip only.

### Files 2-4: Table Components (OperatingSystems, Ziplines, Equipment)

**Changes in each:**
- Add `onDragOver` handler to `DndContext` to track the currently hovered item
- Store `overId` in state alongside `activeId`
- Pass `isOver={overId === item.id}` prop to each `DraggableTableRow` and `DraggableMobileCard`

```typescript
// Add state
const [overId, setOverId] = useState<string | null>(null);

// Add handler
const handleDragOver = useCallback((event) => {
  setOverId(event.over?.id as string ?? null);
}, []);

// Clear on end/cancel
const handleDragEnd = useCallback((event) => {
  setActiveId(null);
  setOverId(null);  // ADD
  // ... existing reorder logic
}, [onUpdate]);

// DndContext
<DndContext
  sensors={sensors}
  collisionDetection={pointerWithin}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}    // NEW
  onDragEnd={handleDragEnd}
  onDragCancel={() => { setActiveId(null); setOverId(null); }}
>

// Each row
<DraggableTableRow
  key={item.id}
  id={item.id}
  gridCols={GRID_COLS}
  isOver={overId === item.id}   // NEW
>
```

### Summary

| File | Changes |
|------|---------|
| `DraggableTableRow.tsx` | Add `isOver` prop. Put `setDragRef` on grip handle (fixes overlay offset). Keep `setDroppableRef` on container (for collision detection). |
| `OperatingSystemsTable.tsx` | Add `overId` state, `onDragOver` handler, pass `isOver` prop to rows. |
| `ZiplinesTable.tsx` | Same as above. |
| `EquipmentTable.tsx` | Same as above. |

### Why this fixes both issues
1. **Drop indicator**: `onDragOver` fires reliably from `DndContext` whenever collision detection matches a droppable. Passing it as a prop bypasses any issues with individual `useDroppable` hooks not receiving updates.
2. **DragOverlay offset**: Moving `setDragRef` back to the grip handle means the overlay measures its initial position from where the user actually clicks, eliminating the horizontal offset.
3. **Collision detection still works**: `setDroppableRef` remains on the full row container, so `pointerWithin` still detects when the cursor enters any row's bounding box.

