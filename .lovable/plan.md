

# Auto-Scroll During Drag-and-Drop

## Problem
When dragging items in lists that exceed the viewport, users cannot reach the top/bottom of the list because scrolling stops — the drag interaction blocks natural scroll behavior.

## Two Drag Systems to Fix

### 1. `useNativeDrag` (inspection tables: Systems, Ziplines, Equipment)
The custom hook handles both desktop HTML5 drag and mobile touch drag but has zero auto-scroll logic. Need to add edge-detection scrolling.

**Approach**: Add a `requestAnimationFrame` auto-scroll loop that activates when the pointer/touch is within an edge zone (e.g., 60px from top/bottom of the scroll container or viewport). Scroll speed accelerates the closer the pointer is to the edge.

- Add a `scrollContainerRef` parameter to `useNativeDrag` so callers can pass their scrollable parent
- In `handleDragOver` (desktop): check `e.clientY` against viewport edges, start/stop scroll loop
- In `handleTouchMove` (touch): same edge detection using `touch.clientY`
- On `clearState`: cancel any running animation frame
- Fallback to `window` scrolling if no container ref provided

### 2. `@dnd-kit` (PhotoGallery, FormCMSManager)
`@dnd-kit`'s `DndContext` supports an `autoScroll` prop out of the box but neither usage configures it. The default auto-scroll may work but can be improved.

**Approach**: Add explicit `autoScroll` configuration to both `DndContext` instances with tuned thresholds and acceleration for smooth edge scrolling inside `ScrollArea` containers.

## Files Changed

- `src/hooks/useNativeDrag.tsx` — add auto-scroll engine with edge detection for both desktop drag and touch drag, using `requestAnimationFrame` loop and configurable edge zone/speed
- `src/components/inspection/OperatingSystemsTable.tsx` — pass scroll container ref to `useNativeDrag`
- `src/components/inspection/ZiplinesTable.tsx` — pass scroll container ref to `useNativeDrag`
- `src/components/inspection/EquipmentTable.tsx` — pass scroll container ref to `useNativeDrag`
- `src/components/PhotoGallery.tsx` — add `autoScroll` prop to `DndContext`
- `src/components/admin/FormCMSManager.tsx` — add `autoScroll` prop to `DndContext` instances

## Auto-Scroll Logic Detail

```text
Edge zone: 60px from top/bottom of container (or viewport)
Speed: linear interpolation — max 12px/frame at edge, 0 at zone boundary
Loop: requestAnimationFrame, cancelled on drag end / clear state

Desktop: clientY checked in handleDragOver
Touch:   clientY checked in handleTouchMove
```

No new dependencies. No new features — purely improving existing drag interactions.

