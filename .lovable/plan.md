

## Premium Drag-and-Drop Visual Refinement

### Problems Identified

After reviewing the current implementation, three root issues cause the poor experience:

1. **Tiny overlay**: The `DragOverlay` renders a small pill-shaped summary card (just name + result badge) instead of a full-width row representation. This makes it feel disconnected from the actual row being dragged.

2. **Weak drop indicator**: The insertion point is shown as a `borderTop: 3px` on the `isOver` item with a faint `bg-primary/5` tint -- too subtle to read quickly during a drag.

3. **No axis restriction**: Items can be dragged freely in both X and Y directions, causing visual wobble. Since these are vertical lists, constraining to the Y-axis would feel much tighter.

### Solution

#### 1. Improved DragOverlay content (all 3 tables)

Replace the small pill overlay with a **full-width row card** that mirrors the actual row layout:
- Full width with `w-full` / `min-w-[400px]`
- Shows a GripVertical icon + item name + result badge in a row layout
- Strong shadow (`shadow-2xl`), solid background, 2px primary left border
- Slight scale (`scale-[1.02]`) and no rotation (rotation causes visual jank)
- Rounded corners with `ring-2 ring-primary/30` for a "selected" glow

#### 2. Enhanced drop target indicator (DraggableTableRow + DraggableMobileCard)

Replace the subtle `borderTop` with a **prominent animated insertion line**:
- Use a `::before` pseudo-element approach via a wrapper div for the mobile card, and inline styles for the table row
- **4px tall, full-width primary-colored bar** positioned at the top of the target row
- Add a subtle **glow effect** using `box-shadow: 0 0 8px hsl(var(--primary) / 0.5)` on the indicator
- Stronger background tint: `bg-primary/10` instead of `bg-primary/5`
- Smooth transition on appearance

#### 3. Add vertical axis restriction

Import `restrictToVerticalAxis` from `@dnd-kit/modifiers` and apply it to all three `DndContext` instances. This locks the drag to vertical movement only, eliminating horizontal wobble and making the interaction feel precise.

#### 4. Reduce original row opacity further

The dragged row placeholder stays at `opacity: 0.3` (good) but add a **dashed border outline** to show the "slot" where the item came from -- a common Kanban pattern.

### Files Changed

| File | Change |
|------|--------|
| `src/components/inspection/DraggableTableRow.tsx` | Enhanced `isOver` indicator (4px glowing bar), dashed border on dragging placeholder, stronger background tint |
| `src/components/inspection/OperatingSystemsTable.tsx` | Full-width overlay card, add `restrictToVerticalAxis` modifier |
| `src/components/inspection/ZiplinesTable.tsx` | Full-width overlay card, add `restrictToVerticalAxis` modifier |
| `src/components/inspection/EquipmentTable.tsx` | Full-width overlay card, add `restrictToVerticalAxis` modifier |

### Technical Details

- `restrictToVerticalAxis` is exported from `@dnd-kit/modifiers` -- this package is NOT currently installed and needs to be added (it's a tiny peer package of dnd-kit)
- Alternative: If we want to avoid a new dependency, we can write a simple custom modifier inline: `({ transform }) => ({ ...transform, x: 0 })` -- same effect, zero dependencies
- All changes use CSS properties that are GPU-composited (transform, opacity, box-shadow)
- No new React state or event handlers added beyond what already exists

### Visual Summary

```text
BEFORE (current):
  [Row 1] ..................  opacity 0.3
  [Row 2] ..................  borderTop: 3px (barely visible)
  [Row 3] ..................
  
  Floating: [Name | Badge]  (tiny pill, can drift sideways)

AFTER (proposed):
  [Row 1] - - - - - - - - -  opacity 0.3, dashed outline (placeholder slot)
  ========================== 4px glowing primary bar (insertion point)
  [Row 2] ..................  bg-primary/10 tint
  [Row 3] ..................
  
  Floating: [Grip | Name ........... | Badge]  (full-width card, Y-axis locked)
```

