

## Fix Drag-and-Drop: Eliminate Row Jumping and Restore Drop Indicator

### True Root Cause (Different from All Previous Attempts)

After deep analysis of the code, the session replay, and the dnd-kit architecture, the real problems are:

**1. Row jumping**: The `verticalListSortingStrategy` calculates CSS transforms for ALL non-active sortable items to visually "make space" during a drag. These transforms (300+ pixels as seen in the session replay) cause the entire table to visually shift, which looks like "the row jumps to the top." This is the core visual chaos.

**2. Missing drop indicator**: The `isOver` flag from `useSortable` relies on dnd-kit's collision detection matching the pointer position to each droppable's measured rect. In `border-collapse` tables, row measurements can be unreliable, causing `isOver` to never become `true` for any row -- so the indicator div never renders.

### Why Previous Fixes Failed

Every previous attempt kept the same two architectural mistakes:
- Kept applying `CSS.Transform` sorting transforms to non-active items (causing the jumping)
- Relied on `useSortable`'s `isOver` for the drop indicator (which doesn't fire reliably in tables)

No amount of CSS styling changes (outline, border, box-shadow, rendered divs) can fix a problem where the indicator simply never renders because `isOver` is always `false`.

### Solution: Remove Sorting Transforms + Manual Drop Target Tracking

**Approach**: Stop using dnd-kit's sorting transforms entirely. Table rows stay in their DOM positions during a drag. The DragOverlay follows the cursor. A manually tracked `overId` powers the insertion indicator. Reorder happens on drop (already works).

This is how Notion, Linear, and other professional table UIs handle drag -- items don't slide around during the drag, they just show an insertion line.

#### Changes to `DraggableTableRow.tsx`

- **Remove all transform application**: Set `transform` to `undefined` always (not just when `isDragging`). Items never move during drag -- they stay in place.
- **Accept `isDropTarget` and `isDragActive` as props** instead of relying on `useSortable`'s unreliable `isOver`.
- **Render the insertion indicator div** based on `isDropTarget` prop (not `isOver`).
- **Keep the placeholder opacity (0.15)** for the active dragged item.
- The `setNodeRef`, `attributes`, `listeners` from `useSortable` are still used for drag handle and droppable registration.

#### Changes to all three table components (OperatingSystemsTable, ZiplinesTable, EquipmentTable)

- **Add `onDragOver` handler** to `DndContext` that tracks `overId` state.
- **Pass `isDropTarget={overId === item.id && activeId !== item.id}`** and `isDragActive={activeId === item.id}` as props to each `DraggableTableRow`.
- **Move `modifiers` from `DndContext` to `DragOverlay`** -- modifiers on DndContext can interfere with collision detection calculations. The Y-axis lock should only affect the visual overlay, not the sorting algorithm.
- No changes to `onDragEnd` logic (reorder on drop stays identical -- zero risk of data loss).

### Data Safety

- The `onDragEnd` handler is completely untouched -- it only calls `arrayMove` when `active.id !== over.id`
- The `onUpdate` callbacks are unchanged
- No database queries, sync logic, or storage code is modified
- Only visual/UI code in the drag components is changed

### Files Changed

| File | What Changes |
|------|-------------|
| `DraggableTableRow.tsx` | Accept `isDropTarget`/`isDragActive` props; remove transform application; use props for indicator instead of `isOver` |
| `OperatingSystemsTable.tsx` | Add `onDragOver` + `overId` state; pass new props to rows; move `modifiers` to `DragOverlay` |
| `ZiplinesTable.tsx` | Same pattern as OperatingSystemsTable |
| `EquipmentTable.tsx` | Same pattern as OperatingSystemsTable |

### Technical Details

**DraggableTableRow new prop interface:**
```text
interface DraggableTableRowProps {
  id: string;
  children: ReactNode;
  className?: string;
  isDropTarget?: boolean;   // NEW: controlled by parent via onDragOver
  isDragActive?: boolean;   // NEW: controlled by parent via activeId
}
```

**DraggableTableRow style (simplified):**
```text
<tr ref={setNodeRef} style={{
  opacity: isDragActive ? 0.15 : 1,
  background: isDragActive ? 'hsl(var(--muted) / 0.5)' : isDropTarget ? 'hsl(var(--primary) / 0.08)' : undefined,
}}>
  <td style={{ position: 'relative', overflow: 'visible' }}>
    {isDropTarget && (
      <div style={{
        position: 'absolute', top: -2, left: -1,
        height: 4, width: '200vw',
        background: 'hsl(var(--primary))',
        boxShadow: '0 0 8px hsl(var(--primary) / 0.5)',
        zIndex: 50, pointerEvents: 'none', borderRadius: 2,
      }} />
    )}
    <GripVertical /> (drag handle)
  </td>
  {children}
</tr>
```

No transforms on any row. The `useSortable` hook is still used for its `setNodeRef` (droppable registration), `attributes`, and `listeners` (drag handle), but its `transform` output is ignored.

**Table component onDragOver pattern:**
```text
const [overId, setOverId] = useState<string | null>(null);

const handleDragOver = useCallback((event) => {
  setOverId(event.over?.id as string ?? null);
}, []);

<DndContext
  sensors={sensors}
  collisionDetection={closestCenter}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
  onDragCancel={() => { setActiveId(null); setOverId(null); }}
>
  ...
  <DraggableTableRow
    id={item.id}
    isDropTarget={overId === item.id && activeId !== item.id}
    isDragActive={activeId === item.id}
  >
  ...
  <DragOverlay modifiers={[restrictToYAxis]} ...>
```

Note: `modifiers` moved from `DndContext` to `DragOverlay` so collision detection uses raw pointer position while the overlay visual is Y-axis locked.

