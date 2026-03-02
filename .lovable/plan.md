

## Add Touch Support to Native HTML5 Drag-and-Drop

### Problem

The current implementation uses native HTML5 drag events (`dragstart`, `dragover`, `drop`). These events **do not fire on mobile touch devices** (iOS Safari, Chrome for Android). This is a fundamental browser limitation — not a bug in the code. Touch devices use `touchstart`/`touchmove`/`touchend` instead.

### Solution

Add touch event handlers alongside the existing drag handlers. The touch handlers will:
1. Detect a long-press on the grip handle to initiate a drag (to distinguish from scroll)
2. Track finger position during `touchmove` to determine which row is being hovered and whether the drop position is above/below
3. Reorder on `touchend` using the same logic as the existing `handleDrop`

### File Changes

#### 1. `src/hooks/useNativeDrag.tsx` — Add touch support

- Add a `longPressTimeout` ref and `LONG_PRESS_MS` constant (e.g., 200ms) to distinguish drag intent from scrolling
- Add `handleTouchStart(id)`: starts a timer; if finger stays still for 200ms, set `draggingId`
- Add `handleTouchMove(e)`: use `document.elementFromPoint(touch.clientX, touch.clientY)` to find which row the finger is over, then calculate midpoint for above/below positioning (same logic as `handleDragOver`)
- Add `handleTouchEnd()`: if a valid drag was in progress, perform the reorder (same logic as `handleDrop`), then clear state
- Add `handleTouchCancel()`: clear all state
- Rows being dragged over need a `data-drag-id` attribute so `elementFromPoint` can identify them
- Return these touch handlers alongside existing drag handlers in `getDragProps`

#### 2. `src/components/inspection/DraggableTableRow.tsx` — Wire touch events

- Accept new touch handler props: `onTouchDragStart`, `onTouchDragMove`, `onTouchDragEnd`, `onTouchDragCancel`
- Attach `onTouchStart` to the **grip handle only** (not the whole row, so form inputs remain interactive)
- Attach `onTouchMove` and `onTouchEnd` to the row container
- Add `data-drag-id={id}` attribute to the row container for element detection
- When touch-dragging is active, add `touch-action: none` to prevent page scrolling
- Same changes for `DraggableMobileCard`

#### 3. `src/components/inspection/EquipmentTable.tsx` — Wire touch props

- EquipmentTable has inline drag handlers (not using `useNativeDrag` hook). Add the same touch handlers inline, or refactor to use `useNativeDrag`.
- Pass touch handler props to `DraggableTableRow` and `DraggableMobileCard`

#### 4. No changes needed for `OperatingSystemsTable.tsx` and `ZiplinesTable.tsx`
- They already use `useNativeDrag` hook, so they automatically get touch support once the hook and `DraggableTableRow` are updated.

### Touch Interaction Flow

```text
User touches grip handle
        |
   200ms hold?
   /         \
  No          Yes
  |            |
Normal      Set draggingId,
scroll      prevent scroll
              |
        touchmove fires
              |
        elementFromPoint()
        finds target row
              |
        Calculate midpoint
        Set dropIndicator
              |
        touchend fires
              |
        Reorder array
        Clear state
```

### Visual Feedback During Touch Drag

- Source row: opacity 0.4 + dashed border (same as desktop)
- Target row: 3px blue line above or below (same as desktop)
- No custom ghost element needed — the visual indicators are sufficient for touch

### Key Technical Details

- `touch-action: none` CSS is applied dynamically only during an active drag to prevent scroll interference while allowing normal scrolling when not dragging
- `document.elementFromPoint()` is used during `touchmove` because touch events don't have a natural "target changes as you move" behavior like `dragover` does
- The long-press threshold prevents accidental drags when the user just wants to scroll past the grip handle
- `e.preventDefault()` is called in `touchmove` only after drag is confirmed to avoid blocking scroll

