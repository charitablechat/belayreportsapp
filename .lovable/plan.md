
Goal: make the Divider row match your screenshot so the grip icon sits within the row height (left rail), not dropped into a separate wrapped line.

1) Root-cause fix (desktop divider layout)
- File: `src/components/inspection/OperatingSystemsTable.tsx`
- Change divider content container from `col-span-full` to `col-span-5`.
- Keep `gridCols={OS_GRID_COLS}` on `DraggableTableRow`.
- Why: with the first drag cell already occupying column 1, `col-span-full` forces a second grid row; `col-span-5` keeps divider content on the same row as the grip cell.

2) Match the reference row structure
- Keep the left drag rail as the first grid cell (40px) with border-right.
- Style divider content to look like one continuous divider bar in the remaining area:
  - wrapper in columns 2–6 (`col-span-5`)
  - centered text input
  - full row-height alignment (`items-center`)
  - keep existing delete action on the right.
- If needed after visual check: add a fixed minimum row height (e.g. `min-h-[56px]`) to ensure the grip remains vertically centered exactly like the screenshot.

3) Keep report rendering unchanged
- No HTML/PDF logic changes needed for this request (already implemented for divider rows).
- This is a layout-only adjustment in the form UI.

4) Validation checklist
- Desktop `/inspection/:id`:
  - Divider row shows grip in the left rail, vertically centered.
  - Divider text field stays on the same horizontal row as grip.
  - No extra blank row above/below divider.
  - Drag/reorder still works for divider rows.
- Mobile:
  - Existing card behavior remains unchanged.

Technical details
- Primary edit target: `src/components/inspection/OperatingSystemsTable.tsx` (divider row JSX classes only).
- Optional fine-tune target (only if necessary): `src/components/inspection/DraggableTableRow.tsx` for handle-cell vertical centering/min-height consistency.
- No database/auth/function migration required.
