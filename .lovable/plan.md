

## Fix Mobile Drag: Browser Text Selection Stealing Touch Sequence

### Root Cause

The screenshot reveals the exact problem: the browser's **native long-press behavior** (text selection + context menu popup "Copy Share Select all Web search") is hijacking the touch sequence before the custom drag handlers can operate.

Here's the sequence of failure:
1. User long-presses the grip handle (200ms timer starts)
2. Browser simultaneously interprets the long-press as a **text selection gesture**
3. Browser shows context menu and highlights nearby text ("Element Name")
4. Browser takes ownership of the touch sequence
5. Subsequent `touchmove` events are consumed by the browser's selection drag, not the custom handler
6. `isDragging` visual state activates (opacity 0.4) but no `touchmove` target detection occurs
7. On `touchend`, refs are still null, so no reorder executes

The grip handle has `touchAction: 'none'` (prevents scroll/zoom) but this does NOT prevent text selection or context menus.

### Fix

Three complementary changes to block all browser interference:

### File 1: `src/hooks/useNativeDrag.tsx`

- In `handleTouchStart`: call `e.preventDefault()` to suppress the browser's default long-press behavior (text selection, context menu). This is the critical fix.

### File 2: `src/components/inspection/EquipmentTable.tsx`

- Same change in its inline `handleTouchStart`: add `e.preventDefault()`.

### File 3: `src/components/inspection/DraggableTableRow.tsx`

- Add CSS `userSelect: 'none'` and `WebkitTouchCallout: 'none'` to the grip handle's inline style (alongside the existing `touchAction: 'none'`). This provides a CSS-level defense against text selection for both iOS (`-webkit-touch-callout`) and Android (`user-select`).
- Apply to both `DraggableTableRow` and `DraggableMobileCard` grip handles.

### Why These Three Together

| Defense Layer | What it blocks | Where |
|---|---|---|
| `e.preventDefault()` on touchstart | Browser default action (text select, context menu) | Event handler |
| `user-select: none` | CSS text selection on drag handle | Grip handle style |
| `-webkit-touch-callout: none` | iOS long-press callout menu | Grip handle style |

### No changes needed to

- `useNativeDrag` touch logic (ref mirroring, drop detection) -- already correct from previous fixes
- `OperatingSystemsTable` / `ZiplinesTable` -- they use `useNativeDrag` hook which gets the fix automatically

### Technical Detail

```text
Before (broken):
  touchstart on grip -> browser starts text selection timer
  200ms later -> both isDragging=true AND browser shows context menu
  touchmove -> browser handles it for selection drag, custom handler starved

After (fixed):
  touchstart on grip -> e.preventDefault() blocks browser defaults
  200ms later -> isDragging=true, no competing browser behavior
  touchmove -> custom handler receives events, detects targets
  touchend -> refs have valid target, reorder executes
```

