## Problem

In `src/components/inspection/ZiplinesTable.tsx`, the desktop grid uses:

```
ZIP_GRID_COLS = "grid-cols-[40px_88px_minmax(120px,1fr)_80px_80px_80px_80px_100px_80px_100px_80px_100px_100px_minmax(120px,1fr)_48px]"
```

The "Line Name" column collapses to its 120px minimum (since the Comments column also competes for `1fr`), so values like "Zipline 1" render as "Zipli…". The cell padding (`p-1`) plus the input's internal padding eats most of those 120px.

## Fix (presentation-only)

1. Widen the Line Name min track and let it grow more aggressively than Comments:
   - Change `minmax(120px,1fr)` (3rd track) → `minmax(180px,1.5fr)`.
   - Keep Comments at `minmax(120px,1fr)` so Line Name wins the extra space.
2. Bump the desktop `min-w-[1200px]` wrapper to `min-w-[1280px]` to absorb the wider Line Name without squeezing numeric columns.
3. On the Line Name `<GlobalAutocomplete>`:
   - Add `w-full` and remove any truncation by ensuring the wrapper cell is `min-w-0` (so flex/grid children can shrink correctly without forcing ellipsis on the input itself).
   - Verify the underlying `<Input>` has no `truncate` class — if so, the `text-overflow: ellipsis` only applies on blur in some browsers; for an editable input we want the value to remain scrollable horizontally, which is the native default. No change needed beyond `w-full`.
4. Mobile/tablet card view (`lg:hidden`) already uses `flex-1 min-w-0` on the Line Name container; no change required.

## Files

- `src/components/inspection/ZiplinesTable.tsx` — update `ZIP_GRID_COLS`, the `min-w-[1200px]` wrapper, and the Line Name cell wrapper / input className.

## Out of scope

- No changes to other inspection tables, schemas, sync, or business logic.
- No changes to column ordering or which fields are displayed.
