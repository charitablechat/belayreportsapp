

## Fix Touch Drop: Stale Closure in handleTouchEnd

### Root Cause

`handleTouchEnd` reads `dragOverId` and `dropPosition` from React state closures. But `handleTouchMove` updates these via `setState`, which is asynchronous. When `touchend` fires immediately after the last `touchmove`, the state hasn't committed yet, so `handleTouchEnd` sees `null` values and skips the reorder.

This doesn't affect desktop because `handleDrop` receives the target id directly from the event (`onDrop={(e) => onRowDrop(e, id)}`), not from state.

### Fix

Add refs that mirror `dragOverId` and `dropPosition`, updated synchronously in `handleTouchMove`. Read refs (not state) in `handleTouchEnd`.

### File 1: `src/hooks/useNativeDrag.tsx`

- Add `dragOverIdRef` and `dropPositionRef` refs alongside the existing state
- In `handleTouchMove`: update both the refs AND the state (state still needed for visual indicator re-renders)
- In `handleTouchEnd`: read from `dragOverIdRef.current` and `dropPositionRef.current` instead of `dragOverId` and `dropPosition` state
- In `clearState`: also reset the new refs to `null`
- Remove `dragOverId` and `dropPosition` from `handleTouchEnd`'s `useCallback` deps (it now reads refs, not state)

### File 2: `src/components/inspection/EquipmentTable.tsx`

Same pattern for inline handlers:
- Add `dragOverIdRef` and `dropPositionRef` refs
- Update refs synchronously in `handleTouchMove`
- Read refs in `handleTouchEnd`
- Reset refs in `clearDragState`

### No changes to `DraggableTableRow.tsx`

The row component just forwards events -- the fix is entirely in the state management layer.

### Technical Details

```text
Before (broken):
  touchmove -> setState(dragOverId)  [async, pending re-render]
  touchend  -> reads dragOverId      [still null from old closure]
  
After (fixed):
  touchmove -> ref.current = id      [sync, immediate]
              + setState(id)         [async, for UI update]
  touchend  -> reads ref.current     [always current]
```

