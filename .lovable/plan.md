

## Analysis

The auto-scroll engine in `useNativeDrag` and `EquipmentTable` uses `EDGE_ZONE = 60px` and `MAX_SCROLL_SPEED = 14px/frame`. The issue is that this speed is too slow for long lists — at 60fps, max speed is ~840px/s. Additionally, when dragging near the very top, the pointer is often within 10-20px of the edge, yielding only partial speed due to the linear interpolation. The scroll also doesn't accelerate over time, so sustained edge-hovering feels sluggish.

## Plan

### 1. Improve auto-scroll in `useNativeDrag.tsx`

Increase edge zone, max speed, and add time-based acceleration:

- **`EDGE_ZONE`**: 60px → 80px (larger trigger zone)
- **`MAX_SCROLL_SPEED`**: 14 → 25 (base max speed)
- **Add acceleration**: Track how long the pointer stays in the edge zone. After 300ms, ramp speed up by 2x; after 600ms, 3x. This makes sustained edge-hovering progressively faster.
- **Quadratic easing**: Change from linear `(EDGE_ZONE - y) / EDGE_ZONE` to quadratic `Math.pow(ratio, 1.5)` so speed ramps more aggressively near the extreme edge.

The `tick` function becomes:
```
const ratio = y < EDGE_ZONE 
  ? (EDGE_ZONE - y) / EDGE_ZONE 
  : (y - (vh - EDGE_ZONE)) / EDGE_ZONE;
const eased = Math.pow(ratio, 1.5);
const accel = Math.min(3, 1 + (elapsedInZone / 500));
speed = direction * MAX_SCROLL_SPEED * eased * accel;
```

### 2. Apply same improvements to `EquipmentTable.tsx`

The EquipmentTable has its own inline copy of the auto-scroll engine. Apply the identical tuning changes there.

### Files Changed
- `src/hooks/useNativeDrag.tsx` — improved auto-scroll engine
- `src/components/inspection/EquipmentTable.tsx` — same improvements to its inline auto-scroll

