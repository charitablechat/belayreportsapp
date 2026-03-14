

## Fix Divider Row Layout

The divider row currently passes `gridCols={undefined}`, which removes the grid layout and causes the grab handle to not align with other rows. The fix is to keep the grid layout for divider rows but have the divider content span the remaining columns.

### Change in `src/components/inspection/OperatingSystemsTable.tsx`

**Desktop (line ~116):** Always pass `gridCols={OS_GRID_COLS}` for divider rows too, then make the divider content span from column 2 to the end using `col-span-5` (covering the 5 remaining columns after the grip column):

```tsx
<DraggableTableRow
  gridCols={OS_GRID_COLS}  // always use grid, not undefined
  ...
>
  {system.is_divider ? (
    <div className="col-span-5 flex items-center bg-blue-100 dark:bg-blue-900/30">
      <div className="p-2 flex-1">
        <Input ... placeholder="Section divider text..." />
      </div>
      <div className="p-2">
        <Button ... /> {/* delete */}
      </div>
    </div>
  ) : ( ... )}
```

This keeps the grab handle rendered by `DraggableTableRow` in the first grid column (40px), with the divider spanning the rest -- matching the uploaded screenshot exactly.

### Files changed
- `src/components/inspection/OperatingSystemsTable.tsx` -- lines ~116-140 only

