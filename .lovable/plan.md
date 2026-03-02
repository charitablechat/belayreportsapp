

## Enhanced Visual Feedback for Drag-and-Drop

### Overview

Upgrade the drag-and-drop visual feedback across all draggable components to provide clear "lifted" states and drop-target indication. The project uses `@dnd-kit/sortable` throughout -- the `useSortable` hook already exposes `isDragging` and `isSortable`/`isOver` properties that we'll leverage.

### Components to Update

There are **5 draggable components** in the project:

| Component | Used By |
|-----------|---------|
| `DraggableTableRow` + `DraggableMobileCard` | Equipment, Systems, Ziplines tables |
| `DraggablePhotoItem` | Photo gallery |
| `DraggableField` | Form CMS admin |
| `DraggableOption` | Form CMS admin options |
| `DraggableSection` | Form CMS admin sections |

### Changes Per Component

#### 1. `DraggableTableRow` (desktop table rows)

**Active drag state:**
- Add `boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)'` when `isDragging`
- Change opacity from `0.4` to `0.8` for better visibility of what's being dragged
- Add `background: 'var(--background)'` so the row doesn't become transparent over other rows
- Add `scale(1.01)` to the transform for a subtle "lift" effect

**Drop target indication:**
- Destructure `isOver` from `useSortable`
- When `isOver` is true and not `isDragging`, apply a top border highlight: `borderTop: '2px solid hsl(var(--primary))'` and a subtle background tint

#### 2. `DraggableMobileCard`

**Active drag state:**
- Same shadow lift and `opacity: 0.8`
- Keep existing `ring-2 ring-primary` but add `shadow-xl` for depth

**Drop target indication:**
- Add `isOver` styling: top border accent + light background tint

#### 3. `DraggablePhotoItem`

**Active drag state:**
- Change opacity from `0.4` to `0.8`
- Add shadow lift
- Keep existing ring styling

**Drop target indication:**
- Add `isOver` border/ring highlight when item is a drop target

#### 4. `DraggableField` and `DraggableOption` (admin CMS)

**Active drag state:**
- Change opacity from `0.5` to `0.8`
- Add shadow lift
- Add `ring-2 ring-primary` when dragging

**Drop target indication:**
- `isOver` top border accent

#### 5. `DraggableSection` (admin CMS)

Same pattern as DraggableField.

### Technical Approach

All changes use the `isOver` property already available from `useSortable()` -- no new dependencies or contexts needed. Styles are applied via inline `style` objects (for dynamic shadow/opacity) and conditional Tailwind classes (for ring/border). This is the same approach already used for `isDragging`.

Example pattern applied to each component:
```typescript
const {
  attributes, listeners, setNodeRef,
  transform, transition,
  isDragging,
  isOver,       // <-- add this
} = useSortable({ id });

const style = {
  transform: CSS.Transform.toString(transform),
  transition: transition || 'transform 200ms ease',
  opacity: isDragging ? 0.8 : 1,
  zIndex: isDragging ? 50 : 'auto',
  boxShadow: isDragging
    ? '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)'
    : 'none',
  background: isDragging ? 'var(--background)' : undefined,
};

// For the container element, add isOver class:
className={`... ${isOver && !isDragging ? 'border-t-2 border-primary bg-primary/5' : ''}`}
```

### Files Changed

| File | Change |
|------|--------|
| `src/components/inspection/DraggableTableRow.tsx` | Add shadow lift, `isOver` drop indicator, adjust opacity for both `DraggableTableRow` and `DraggableMobileCard` |
| `src/components/DraggablePhotoItem.tsx` | Add shadow lift, `isOver` drop indicator, adjust opacity |
| `src/components/admin/DraggableField.tsx` | Add shadow lift, `isOver` drop indicator, adjust opacity |
| `src/components/admin/DraggableOption.tsx` | Add shadow lift, `isOver` drop indicator, adjust opacity |
| `src/components/admin/DraggableSection.tsx` | Add shadow lift, `isOver` drop indicator, adjust opacity |

### Performance Notes

- All visual changes use CSS properties (`box-shadow`, `opacity`, `border`) that are GPU-composited
- No new DOM elements, event listeners, or React state added
- `isOver` is already computed by dnd-kit internally -- we're just reading it
