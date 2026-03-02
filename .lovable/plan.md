

## Fix: Eliminate Row Transforms to Stop Jumping

### Problem
The `verticalListSortingStrategy` applies large Y-axis transforms to ALL rows during drag (shifting them up/down to "make space"). This causes the visible jumping behavior. The DragOverlay already provides the visual ghost -- the rows themselves should stay put.

### Changes: `DraggableTableRow.tsx` only

All three changes target the `style` object in both `DraggableTableRow` and `DraggableMobileCard`:

1. **Set `transform` to `undefined`** -- Rows stay in their original DOM position. The `DragOverlay` handles the moving visual. `useSortable` still tracks `isOver` for the drop indicator.
2. **Lower opacity to `0.15`** -- Makes the source row nearly invisible so the DragOverlay ghost is the clear focal point.
3. **Remove `transition`** -- No transition needed since there's no transform to animate. Prevents visual artifacts.

```typescript
// DraggableTableRow style (lines 24-29)
const style = {
  transform: undefined,        // was: CSS.Transform.toString(transform)
  transition: undefined,       // was: transition || 'transform 200ms ease'
  opacity: isDragging ? 0.15 : 1,  // was: 0.3
  zIndex: isDragging ? 50 : 'auto' as const,
};

// DraggableMobileCard style (lines 71-76) -- identical change
const style = {
  transform: undefined,
  transition: undefined,
  opacity: isDragging ? 0.15 : 1,
  zIndex: isDragging ? 50 : 'auto' as const,
};
```

### What stays the same
- `useSortable` hook stays (provides `isOver`, `isDragging`, `attributes`, `listeners`)
- `SortableContext` in table components stays (provides collision detection)
- Drop indicator (`isOver && !isDragging`) stays
- `DragOverlay` in table components stays (cursor-following ghost)
- All data mutation logic (`handleDragEnd`, `arrayMove`, `onUpdate`) untouched
- CSS-Grid layout untouched
- The `CSS` import from `@dnd-kit/utilities` can be removed since it's no longer used

### Why this works
- Rows don't move = no jumping
- `isOver` still fires correctly because `useSortable` tracks pointer position against droppable rects (the rects don't change since rows are static)
- DragOverlay follows cursor independently (already confirmed working in recording)
- `handleDragEnd` receives correct `active.id` and `over.id` from the collision detection layer, so reordering logic works

### Files modified
| File | Change |
|------|--------|
| `DraggableTableRow.tsx` | Set transform/transition to undefined, opacity to 0.15 in both components. Remove unused `CSS` import. |

No changes needed in the three table components -- they already have `SortableContext` and `DragOverlay` set up correctly.
