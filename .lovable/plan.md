

## Why Drag-and-Drop Keeps Failing (And the Real Fix)

### The Actual Root Cause

The photo drag-and-drop works perfectly. The table row drag-and-drop doesn't. The difference is NOT about CSS indicators, transforms, or collision detection. It's about **one thing**:

**Photos use `<div>` elements. Table rows use `<tr>` elements.**

HTML `<table>` / `<tr>` / `<td>` elements are governed by the browser's **table layout algorithm**, which is fundamentally incompatible with CSS transforms:

- The browser recalculates cell positions during table layout, fighting any transform applied
- `border-collapse` clips box-shadows, outlines, and absolutely-positioned children
- `overflow-x-auto` on the table wrapper clips anything that extends beyond the table
- The browser's rect measurements for `<tr>` elements inside collapsed tables return inconsistent values, which breaks dnd-kit's collision detection (`closestCenter` can't reliably determine which row the cursor is over)

Every previous fix tried to work around these issues while keeping the `<table>` structure. That's why none of them worked -- the `<table>` element IS the problem.

### The Fix: Replace `<table>` with CSS Grid `<div>`s

Convert the desktop table from HTML `<table>/<tr>/<td>` to `<div>` elements using CSS Grid, styled to look identical to the current table. This is the exact same element type that makes the photo drag-and-drop work.

Once rows are `<div>` elements:
- CSS transforms work correctly (items slide smoothly during drag)
- `isOver` from `useSortable` fires reliably (no need for manual `overId` tracking)
- `box-shadow` and `ring` indicators render without clipping
- We can use the exact same pattern as `DraggablePhotoItem` which already works

### What Changes

#### `DraggableTableRow.tsx` -- Rewrite to match DraggablePhotoItem pattern

Replace the `<tr>` with a `<div>` that uses the **same working pattern** as `DraggablePhotoItem`:

```text
- Use CSS.Transform.toString(transform) -- exactly like photos
- Use transition from useSortable -- exactly like photos
- Use isDragging and isOver from useSortable -- exactly like photos
- Remove isDropTarget/isDragActive props -- no longer needed
- Render as <div> with CSS Grid columns -- not <tr>/<td>
```

The component will render a `<div>` with `display: grid` and the same column template as the table header, with borders styled via CSS to look like a table row.

#### `OperatingSystemsTable.tsx` -- Convert table to grid

- Replace `<table>` + `<thead>` + `<tbody>` with `<div>` containers
- Header becomes a `<div>` with CSS Grid columns
- Each row content (currently `<td>` children passed to DraggableTableRow) becomes `<div>` cells inside DraggableTableRow
- Remove `overId` state and `onDragOver` handler (no longer needed -- `useSortable` handles it)
- Keep `activeId` for DragOverlay content only
- Keep `onDragEnd` logic exactly as-is (arrayMove -- zero data risk)

#### `ZiplinesTable.tsx` -- Same conversion

- Same table-to-grid conversion
- Same removal of manual overId tracking
- onDragEnd logic untouched

#### `EquipmentTable.tsx` -- Same conversion

- Same table-to-grid conversion
- Same removal of manual overId tracking
- onDragEnd logic untouched

#### `DraggableMobileCard` -- Minor cleanup

Already uses `<div>`, so it mostly works. Just apply the same `CSS.Transform` pattern as DraggablePhotoItem (use transform + transition from useSortable, use isDragging/isOver directly).

### Data Safety

- `onDragEnd` handlers are completely untouched -- same `arrayMove` logic
- `onUpdate` callbacks are unchanged
- No database, sync, or storage code is modified
- Only visual/layout markup changes

### Why This Will Work

This isn't a theory -- the proof is already in the codebase. `DraggablePhotoItem` uses `<div>` + `CSS.Transform` + `isOver` and works perfectly. We're applying the exact same pattern to table rows by converting them from `<tr>` to `<div>`.

### Technical Details

**DraggableTableRow new structure:**

```text
<div
  ref={setNodeRef}
  style={{
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 200ms ease',
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto',
    boxShadow: isDragging ? '0 10px 15px -3px rgba(0,0,0,0.1)' : 'none',
  }}
  className={`grid [grid-template-columns] border-b
    ${isDragging ? 'ring-2 ring-primary ring-offset-2' : ''}
    ${isOver && !isDragging ? 'ring-2 ring-primary bg-primary/5' : ''}
  `}
>
  <div className="p-2 flex items-center justify-center border-r">
    <div {...attributes} {...listeners} className="cursor-grab">
      <GripVertical />
    </div>
  </div>
  {children}  <!-- now <div> cells instead of <td> cells -->
</div>
```

**Grid column template per table:**

- OperatingSystems: `grid-cols-[40px_minmax(180px,1fr)_minmax(160px,1fr)_192px_1fr_64px]`
- Ziplines: Will match current column widths
- Equipment: Will match current column widths

The header row uses the same grid template so columns stay aligned.

**Files changed:**

| File | Change |
|------|--------|
| `DraggableTableRow.tsx` | Convert `<tr>` to `<div>` with CSS Grid; use same pattern as working DraggablePhotoItem |
| `OperatingSystemsTable.tsx` | Convert `<table>` to grid divs; remove manual overId tracking; children become `<div>` cells |
| `ZiplinesTable.tsx` | Same conversion pattern |
| `EquipmentTable.tsx` | Same conversion pattern |
