

## Problem

The session replay clearly shows the issue: when dragging a row **upward** toward the top of the viewport, the auto-scroll engine stalls. This happens because `pointerYRef` is only updated inside `handleDragOver`, which fires on individual rows. Once the pointer moves above all visible rows (into the edge zone near the viewport top), no row receives `dragover` events, so `pointerYRef` stops updating and scrolling halts. The user has to manually jiggle the mouse back down onto a row to re-trigger scrolling.

## Solution

Add a **document-level `dragover` listener** during the entire drag operation so `pointerYRef` is always fed the current pointer position — even when the cursor is outside any row element. This guarantees continuous auto-scroll regardless of where the pointer is.

### Changes

**`src/hooks/useNativeDrag.tsx`**

1. In `handleDragStart`: attach `document.addEventListener('dragover', globalDragHandler)` that updates `pointerYRef.current = e.clientY` on every frame.
2. In `clearState`: remove the global listener via `document.removeEventListener`.
3. Store the handler ref so cleanup works correctly.
4. Keep existing per-row `handleDragOver` for drop-indicator logic — just remove the `pointerYRef` update from it (the global handler covers it).

**`src/components/inspection/EquipmentTable.tsx`**

Apply the same document-level `dragover` listener pattern to its inline auto-scroll implementation.

### Why this works

The browser fires `dragover` on `document` continuously (~60fps) during any HTML5 drag, regardless of what element is under the cursor. By listening at the document level, the auto-scroll engine always knows the pointer Y position and can scroll smoothly even when the cursor is above all rows or in empty space.

