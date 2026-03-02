

## Fix: DragOverlay Jumping to Left Edge of Screen

### Root Cause (Confirmed from Session Replay)

The `DragOverlay` component renders with `position: fixed; top: 0; left: 0` and uses `transform: translate3d(x, y, 0)` to follow the cursor. The custom `restrictToYAxis` modifier forces `x: 0`, which pins the overlay to x=0 (the left edge of the viewport) instead of following the cursor horizontally.

Session replay proof: the overlay div consistently gets `transform: translate3d(0px, 289px, 0px)` — correct Y position, but X always forced to 0.

### What's Already Working

The CSS Grid conversion from the previous fix **did work**:
- Rows no longer jump/shift during drag (transforms are applied correctly to divs)
- The `isOver` drop indicator IS firing (replay shows `ring-2 ring-primary bg-primary/5` class applied to the target row)

The only remaining issue is the overlay position caused by the modifier.

### Fix

**Remove `modifiers={[restrictToYAxis]}` from all three DragOverlay components** and delete the unused `restrictToYAxis` callback from each file. The overlay should follow the cursor naturally — no axis restriction needed since the overlay is just a visual ghost, not the actual row.

### Files Changed

| File | Change |
|------|--------|
| `OperatingSystemsTable.tsx` | Remove `restrictToYAxis` callback (lines 47-50) and `modifiers` prop from DragOverlay (line 236) |
| `ZiplinesTable.tsx` | Remove `restrictToYAxis` callback (lines 48-51) and `modifiers` prop from DragOverlay (line 347) |
| `EquipmentTable.tsx` | Remove `restrictToYAxis` callback (lines 53-56) and `modifiers` prop from DragOverlay (line 379) |

### Data Safety

Zero risk — only removes a visual modifier from the drag overlay. No changes to `onDragEnd`, `onUpdate`, `arrayMove`, or any data logic.

