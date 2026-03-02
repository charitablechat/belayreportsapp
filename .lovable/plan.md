
## Fix: Actually Remove Sorting Transforms from Table Rows

### Why It's Still Broken

Every previous fix plan said "remove transforms" but the code at `DraggableTableRow.tsx` line 25 still has:
```
transform: CSS.Transform.toString(transform),
```

This single line is the entire problem. The `verticalListSortingStrategy` calculates Y-axis transforms for ALL sortable items during a drag to visually "make space." For tall table rows with rich text editors and selects, these transforms are 100-300+ pixels, causing the dramatic jumping effect.

The photo gallery works because `rectSortingStrategy` with small fixed-height cards produces small, manageable transforms. The table rows are tall and variable-height, making the same mechanism look broken.

### The Fix (Simple and Definitive)

**`DraggableTableRow.tsx`** - Set transform to `undefined` always. Rows stay in their DOM positions during drag. The DragOverlay (already working correctly since restrictToYAxis was removed) follows the cursor as the visual ghost. `isOver` from `useSortable` provides the drop indicator. `arrayMove` in `onDragEnd` handles the actual reorder on drop.

Changes:
- Line 25: `transform: CSS.Transform.toString(transform)` becomes `transform: undefined`
- Line 27: opacity when dragging changes from `0.5` to `0.15` (make the source row nearly invisible so the DragOverlay is the clear focus)
- Same changes for `DraggableMobileCard` (lines 72-73)

**No changes to any table component files.** The fix is entirely within DraggableTableRow.tsx.

### Why This Will Work

This is a one-file, two-line change that removes the exact mechanism causing the jumping. Everything else is already working:
- CSS Grid divs: done (previous fix)
- DragOverlay follows cursor: done (restrictToYAxis removed)
- `isOver` indicator: works on div elements
- `arrayMove` reorder: untouched, works correctly

### Data Safety

Zero risk. Only visual properties (transform, opacity) are changed. No changes to `onDragEnd`, `onUpdate`, `arrayMove`, or any data/sync logic.

### Technical Details

**Before (DraggableTableRow style):**
```text
const style = {
  transform: CSS.Transform.toString(transform),  // PROBLEM: moves all rows
  transition: transition || 'transform 200ms ease',
  opacity: isDragging ? 0.5 : 1,
  ...
};
```

**After:**
```text
const style = {
  transform: undefined,  // Rows stay in place
  transition: undefined, // No transition needed
  opacity: isDragging ? 0.15 : 1,  // Nearly invisible when being dragged
  ...
};
```

Same change applied to `DraggableMobileCard`.

### File Changed

| File | Change |
|------|--------|
| `DraggableTableRow.tsx` | Remove transform application (set to undefined); reduce dragging opacity to 0.15; same for mobile card |
