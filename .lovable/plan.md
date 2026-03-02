

## Improve Drag-and-Drop Feel with DragOverlay

### Problem

The current drag-and-drop in the inspection tables (Systems, Ziplines, Equipment) lacks a `DragOverlay` -- the floating preview element that visually follows the cursor during a drag. Without it, the row just shifts in-place with subtle opacity/shadow changes, making it feel like nothing is being "held." The PhotoGallery already uses `DragOverlay` correctly and feels smooth; the inspection tables need the same treatment.

### Root Cause

`@dnd-kit` uses `DragOverlay` to render a floating clone of the dragged item above everything else. Without it, the only visual feedback is the in-place transform on the original row, which is barely noticeable inside a dense table.

### Solution

Add `DragOverlay` with `DragStartEvent` tracking to all three table components and the shared `DraggableTableRow` component. When a drag starts, store the active item; render a simplified floating preview in `DragOverlay`; clear it on drag end.

---

### 1. Update `DraggableTableRow.tsx`

- Make the dragging row nearly invisible (`opacity: 0.3`) since the `DragOverlay` will show the floating clone
- Keep the `isOver` drop-target styling (top border + background tint)

### 2. Update `OperatingSystemsTable.tsx`

- Import `DragOverlay` and `DragStartEvent` from `@dnd-kit/core`
- Add `useState` for `activeId` (the ID of the item currently being dragged)
- Add `onDragStart` handler to set `activeId`
- Update `onDragEnd` to clear `activeId`
- Render `<DragOverlay>` after `</SortableContext>` showing a styled summary row of the active item (system name + result) with a lifted shadow appearance
- The overlay renders a simplified card/row so the user sees exactly what they're moving

### 3. Update `ZiplinesTable.tsx`

Same pattern: track `activeId`, render `DragOverlay` with a summary of the active zipline (name + type + result).

### 4. Update `EquipmentTable.tsx`

Same pattern: track `activeId`, render `DragOverlay` with a summary of the active equipment item (name + type + result).

### Visual Design of the Drag Overlay

The floating preview will be:
- A compact card with rounded corners, strong shadow (`shadow-2xl`), slight scale (`scale-105`), and a subtle rotation (`rotate-1`) for a "picked up" feel
- Background matches the app theme (`bg-background`)
- Shows the item's key identifying info (name and result) so the user knows what they're holding
- Has a primary-colored left border accent for visibility

### Drop Target Enhancement

The existing `isOver` border-top indicator is subtle. Enhance it:
- Increase from `2px` to `3px` border
- Add a transition so the indicator animates in smoothly

---

### Files Changed

| File | Change |
|------|--------|
| `src/components/inspection/DraggableTableRow.tsx` | Lower dragging row opacity to 0.3 (since overlay shows the clone); add smooth transition for isOver styles |
| `src/components/inspection/OperatingSystemsTable.tsx` | Add `DragOverlay` with floating preview card; track `activeId` via `onDragStart` |
| `src/components/inspection/ZiplinesTable.tsx` | Add `DragOverlay` with floating preview card; track `activeId` via `onDragStart` |
| `src/components/inspection/EquipmentTable.tsx` | Add `DragOverlay` with floating preview card; track `activeId` via `onDragStart` |

### Technical Notes

- Follows the exact same `DragOverlay` pattern already used in `PhotoGallery.tsx`
- No new dependencies -- `DragOverlay` and `DragStartEvent` are already exported from `@dnd-kit/core`
- The overlay is rendered outside the `SortableContext` but inside `DndContext`, which is the correct placement
- Performance: `DragOverlay` uses a portal by default, avoiding layout thrashing

