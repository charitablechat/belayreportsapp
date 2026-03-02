

## Fix: Switch to pointerWithin Collision + Verify DragOverlay Positioning

### Root Cause Analysis (from Session Replay)

The session replay shows element 2052 (DragOverlay) receiving smooth `translate3d` updates frame-by-frame (207px,57px -> 207px,50px -> 206px,51px -> ...). This confirms the **DragOverlay IS tracking the cursor correctly at the dnd-kit level**.

However, three things are broken:

1. **"Jumps to top"**: The DragOverlay uses `position: fixed` and renders via React Portal to document.body. The transform values are DELTAS from the initial grab point. If the page is scrolled (the user is at y=2264-2385 scroll position per the replay), the DragOverlay appears at the correct viewport-relative position but may visually "jump" because the source row becomes nearly invisible (opacity: 0.15) and the overlay ghost appears at the cursor -- which IS correct behavior, but feels like a jump because the ghost is a slim summary bar while the source was a full row.

2. **"Drop indicator never appears"**: `closestCenter` requires the pointer to be closer to a NEIGHBOR's center than the active item's center. Even though we filter out the active item, for tall rows the pointer must travel far enough to cross into the next row's vertical zone. The `closestCenter` algorithm calculates Euclidean distance to centers, which can cause the nearest match to "flicker" or not register if the pointer is between two rows. Switching to `pointerWithin` solves this -- it simply checks if the pointer is geometrically inside a droppable rect, giving a 1:1 mapping.

3. **"Doesn't follow cursor"**: This is a perception issue -- the overlay DOES follow (confirmed by replay data), but it may appear offset if there's a CSS `transform` ancestor causing coordinate space issues. Need to verify no parent has transforms that would shift the fixed-position overlay.

### The Fix: 3 Targeted Changes

#### Change 1: Switch collision detection from closestCenter to pointerWithin

`pointerWithin` checks if the pointer falls inside a droppable rect. Since rows are stacked vertically with no gaps, exactly ONE row will match at any time. This gives:
- Instant detection (no "closer to center" threshold to cross)
- No flickering between candidates
- `isOver` on `useDroppable` fires immediately when the pointer enters a row

```text
// In each table component, change:
import { closestCenter, ... } from "@dnd-kit/core";
// To:
import { pointerWithin, ... } from "@dnd-kit/core";

// And change the collision function:
const collisionDetection: CollisionDetection = useCallback((args) => {
  const filtered = args.droppableContainers.filter(c => c.id !== args.active.id);
  return pointerWithin({ ...args, droppableContainers: filtered });
}, []);
```

#### Change 2: Make the source row placeholder more visible

Currently `opacity: 0.15` makes it nearly invisible, contributing to the "jump" perception. Change to a dashed-border placeholder style so the user sees where the row came from:

```text
// DraggableTableRow: instead of just opacity
style={{ opacity: isDragging ? 0.3 : 1 }}
className={`... ${isDragging ? 'bg-muted/50 border-dashed' : ''}`}
```

#### Change 3: Strengthen the drop indicator

The current 3px line with translate-y-1/2 may be clipped by `overflow-x-auto` on the desktop container. Add `overflow-visible` to the row and make the indicator thicker with animation:

```text
{isOver && !isDragging && (
  <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary z-50 
    -translate-y-1/2 rounded-full shadow-[0_0_8px_2px_hsl(var(--primary)/0.4)]
    animate-pulse" />
)}
```

### Files Changed

| File | Change |
|------|--------|
| `DraggableTableRow.tsx` | Increase opacity to 0.3, add dashed border when dragging, strengthen indicator with z-50 and animate-pulse, add overflow-visible |
| `OperatingSystemsTable.tsx` | Switch `closestCenter` to `pointerWithin` in import and collision function |
| `ZiplinesTable.tsx` | Same collision detection switch |
| `EquipmentTable.tsx` | Same collision detection switch |

### Data Safety

Zero risk. Only collision algorithm and visual styling changes. `arrayMove`, `onUpdate`, `handleDragEnd` logic completely untouched.

### Why This Will Actually Work

- `pointerWithin` gives deterministic 1:1 row targeting -- the pointer is either inside a row or not
- Filtering out the active item means only neighbor rows can be targets
- `useDroppable.isOver` fires reliably with `pointerWithin` since it's a simple rect containment check
- The DragOverlay already tracks perfectly (session replay proves this)
- The stronger indicator (z-50, animate-pulse) ensures visibility even with overflow containers

