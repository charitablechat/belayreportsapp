

## Fix Touch Drag on Mobile: Replace Passive Listeners with Active Refs

### Root Cause

React registers `onTouchMove` as a **passive** event listener. Passive listeners cannot call `e.preventDefault()` -- the browser silently ignores it. This means:
1. The page scrolls during a touch drag, causing `elementFromPoint()` to return wrong targets
2. The drag feels unresponsive or broken on iOS/Android

Additionally, `touch-action: none` is set via React state (`isDragging`), but the re-render happens too late -- the browser has already begun its native scroll gesture by then.

### Solution

Use `useEffect` + `addEventListener('touchmove', handler, { passive: false })` on the row container via a ref, instead of React's `onTouchMove` prop. This gives us a non-passive listener where `preventDefault()` actually works.

### File 1: `src/hooks/useNativeDrag.tsx`

**Changes:**
- Remove `handleTouchMove` from the returned `getDragProps` (it will be attached via ref instead)
- Export a new `touchMoveHandler` function that can be attached imperatively
- Add a `containerRef` callback pattern: return a `getContainerProps(id)` that includes a ref callback which attaches the non-passive `touchmove` listener
- Alternatively (simpler): return the raw `handleTouchMove` function so `DraggableTableRow` can attach it via `useEffect`

Chosen approach -- return the handler and let the row component attach it:

```typescript
// getDragProps returns:
{
  ...existingProps,
  onTouchDragMove: handleTouchMove,  // still returned, but NOT used as React prop
  touchMoveRef: handleTouchMove,     // same function, used by DraggableTableRow via useEffect
}
```

No logic changes to the handler itself -- the midpoint detection and `elementFromPoint` logic is correct. The only issue is the passive listener.

### File 2: `src/components/inspection/DraggableTableRow.tsx`

**DraggableTableRow changes:**
- Add a `useRef` for the row container div
- Add a `useEffect` that attaches `addEventListener('touchmove', handler, { passive: false })` to the ref element
- Remove `onTouchMove={onTouchDragMove}` from the JSX (this was the passive listener)
- Set `touch-action: none` on the grip handle element always (not conditionally via state), so the browser never initiates a scroll gesture when the user touches the grip. This is safe because the grip handle is small and not scrollable content.

```typescript
// Key pattern:
const rowRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  const el = rowRef.current;
  if (!el || !onTouchDragMove) return;
  const handler = (e: TouchEvent) => {
    onTouchDragMove(e as unknown as React.TouchEvent);
  };
  el.addEventListener('touchmove', handler, { passive: false });
  return () => el.removeEventListener('touchmove', handler);
}, [onTouchDragMove]);
```

- Apply `touch-action: none` to the grip handle div (always), not to the row container conditionally

**DraggableMobileCard changes:**
- Same ref + useEffect pattern for non-passive touchmove
- Same `touch-action: none` on the grip handle

### File 3: `src/components/inspection/EquipmentTable.tsx`

- Same change: the inline `handleTouchMove` is already correct, but the `DraggableTableRow` it passes it to will now use it via ref instead of React prop. No changes needed in EquipmentTable itself -- the fix is entirely in DraggableTableRow.

### Changes Summary

| File | Change |
|------|--------|
| `DraggableTableRow.tsx` | Add `useRef` + `useEffect` to attach `touchmove` with `{ passive: false }`. Remove `onTouchMove` React prop from the div. Add `touch-action: none` to grip handle. Same for `DraggableMobileCard`. |
| `useNativeDrag.tsx` | No logic changes. The `handleTouchMove` function is already correct -- it just needs to be called from a non-passive listener. |
| `EquipmentTable.tsx` | No changes needed. |

### Why This Fixes Mobile

1. **`preventDefault()` works**: Non-passive listener means the browser actually stops scrolling during a drag
2. **`elementFromPoint()` accurate**: Without scroll interference, the finger position maps correctly to row elements
3. **No timing race**: `touch-action: none` on the grip handle prevents the browser from ever initiating a scroll gesture when the drag starts from the grip, eliminating the state-update-too-late problem
4. **Desktop unaffected**: Native HTML5 drag events continue to work as before

