

## Fix Mobile Drop: Remove `draggable` Interference on Touch Devices

### Root Cause

The row containers (`DraggableTableRow` and `DraggableMobileCard`) have `draggable={true}` set unconditionally. On mobile browsers (especially Android Chrome), this causes the browser to intercept the touch sequence for its own native drag behavior. This can:

1. Fire `dragend` (which calls `clearState()`, wiping the refs before `touchend` reads them)
2. Fire `touchcancel` (which also calls `clearState()`)
3. Show a native long-press context menu or drag ghost that steals the touch

The desktop HTML5 drag handlers and touch handlers are fighting over the same interaction on mobile.

### Fix

Only set `draggable={true}` when NOT in a touch drag. During a touch-initiated drag, the touch handlers manage everything -- the HTML5 `draggable` attribute must not interfere.

### File: `src/components/inspection/DraggableTableRow.tsx`

**DraggableTableRow changes:**
- Accept a new `isTouchDragging` prop (already returned by `getDragProps` in `useNativeDrag` but not wired)
- Set `draggable={!isTouchDragging}` instead of `draggable={true}` -- when a touch drag is active, disable the HTML5 draggable attribute so the browser doesn't fire competing drag/dragend events
- Alternatively, detect touch capability and only set `draggable` on non-touch devices. But the simpler approach is using the existing `isTouchDragging` flag.

**DraggableMobileCard changes:**
- Same: accept `isTouchDragging`, set `draggable={!isTouchDragging}`
- Since mobile cards are exclusively shown on mobile viewports, we can go further and set `draggable={false}` entirely (touch handlers handle everything on mobile). This is the cleaner approach for the mobile card variant.

### File: `src/hooks/useNativeDrag.tsx`

- The `isTouchDragging` value is already computed in `getDragProps` (`touchActiveRef.current && draggingId === id`), but there's a subtle bug: `touchActiveRef.current` is a ref read during render, which won't trigger re-renders. Fix: derive `isTouchDragging` from the `draggingId` state plus a new `isTouchMode` state boolean that's set to `true` alongside `touchActiveRef` in the long-press timer callback and cleared in `clearState`.

### File: `src/components/inspection/EquipmentTable.tsx`

- Same pattern: pass `isTouchDragging` (derived from a `touchMode` state) to `DraggableTableRow` and `DraggableMobileCard`
- For the mobile cards, simply set `draggable={false}` since they only render on mobile viewports where touch is the only interaction method

### Technical Details

| Component | Current | Fixed |
|-----------|---------|-------|
| `DraggableTableRow` | `draggable={true}` always | `draggable={!isTouchDragging}` |
| `DraggableMobileCard` | `draggable={true}` always | `draggable={false}` (mobile-only component) |
| `useNativeDrag` | `isTouchDragging` uses ref (no re-render) | Add `isTouchMode` state for reactivity |
| `EquipmentTable` | Same issue | Same fix pattern |

### Why This Fixes Mobile Drop

Without `draggable` on the element, the browser has no reason to intercept the touch for HTML5 drag behavior. The touch handlers operate without interference:
- `touchstart` on grip fires cleanly
- `touchmove` tracked via non-passive listener
- `touchend` fires normally (no competing `dragend` or `touchcancel`)
- Refs contain valid data when `handleTouchEnd` reads them

Desktop behavior is unaffected because touch events don't fire on desktop, so `isTouchDragging` stays false and `draggable={true}` remains active.

