import { useState, useRef, useCallback, useEffect } from "react";

const LONG_PRESS_MS = 200;
const EDGE_ZONE = 80; // px from viewport edge to trigger scroll
const MAX_SCROLL_SPEED = 25; // px per frame at the very edge

export function useNativeDrag<T extends { id: string }>(
  items: T[],
  onReorder: (reordered: T[]) => void,
) {
  const draggedIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'above' | 'below' | null>(null);
  const [isTouchMode, setIsTouchMode] = useState(false);

  // Refs mirroring state for synchronous access in handleTouchEnd
  const dragOverIdRef = useRef<string | null>(null);
  const dropPositionRef = useRef<'above' | 'below' | null>(null);

  // Touch-specific refs
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchActiveRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // --- Auto-scroll engine ---
  const scrollRafRef = useRef<number | null>(null);
  const pointerYRef = useRef<number | null>(null);
  const edgeEnteredAtRef = useRef<number | null>(null);
  const globalDragHandlerRef = useRef<((e: DragEvent) => void) | null>(null);

  const startAutoScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return; // already running
    edgeEnteredAtRef.current = null;

    const tick = () => {
      const y = pointerYRef.current;
      if (y === null) {
        edgeEnteredAtRef.current = null;
        scrollRafRef.current = requestAnimationFrame(tick);
        return;
      }

      const vh = window.innerHeight;
      let speed = 0;
      let ratio = 0;
      let direction = 0;

      if (y < EDGE_ZONE) {
        ratio = (EDGE_ZONE - y) / EDGE_ZONE;
        direction = -1;
      } else if (y > vh - EDGE_ZONE) {
        ratio = (y - (vh - EDGE_ZONE)) / EDGE_ZONE;
        direction = 1;
      }

      if (direction !== 0) {
        const now = performance.now();
        if (edgeEnteredAtRef.current === null) edgeEnteredAtRef.current = now;
        const elapsed = now - edgeEnteredAtRef.current;
        const accel = Math.min(3, 1 + (elapsed / 500));
        const eased = Math.pow(ratio, 1.5);
        speed = direction * MAX_SCROLL_SPEED * eased * accel;
      } else {
        edgeEnteredAtRef.current = null;
      }

      if (speed !== 0) {
        window.scrollBy({ top: speed, behavior: 'instant' as ScrollBehavior });
      }

      scrollRafRef.current = requestAnimationFrame(tick);
    };

    scrollRafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    pointerYRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAutoScroll();
    };
  }, [stopAutoScroll]);

  const removeGlobalDragListener = useCallback(() => {
    if (globalDragHandlerRef.current) {
      document.removeEventListener('dragover', globalDragHandlerRef.current);
      globalDragHandlerRef.current = null;
    }
  }, []);

  const addGlobalDragListener = useCallback(() => {
    removeGlobalDragListener();
    const handler = (e: DragEvent) => {
      pointerYRef.current = e.clientY;
    };
    globalDragHandlerRef.current = handler;
    document.addEventListener('dragover', handler);
  }, [removeGlobalDragListener]);

  const clearState = useCallback(() => {
    draggedIdRef.current = null;
    dragOverIdRef.current = null;
    dropPositionRef.current = null;
    touchActiveRef.current = false;
    touchStartPosRef.current = null;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    removeGlobalDragListener();
    stopAutoScroll();
    setDraggingId(null);
    setDragOverId(null);
    setDropPosition(null);
    setIsTouchMode(false);
  }, [stopAutoScroll, removeGlobalDragListener]);

  // --- Native HTML5 drag handlers (desktop) ---

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    draggedIdRef.current = id;
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    addGlobalDragListener();
    startAutoScroll();
  }, [startAutoScroll, addGlobalDragListener]);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Feed pointer position to auto-scroll engine
    pointerYRef.current = e.clientY;

    if (id === draggedIdRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    setDragOverId(id);
    setDropPosition(e.clientY < midpoint ? 'above' : 'below');
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
    setDropPosition(null);
  }, []);

  const performReorder = useCallback((targetId: string, pos: 'above' | 'below' | null) => {
    const dragId = draggedIdRef.current;
    if (!dragId || dragId === targetId || !pos) return;

    const newItems = [...items];
    const dragIdx = newItems.findIndex(i => i.id === dragId);
    if (dragIdx === -1) return;
    const [draggedItem] = newItems.splice(dragIdx, 1);
    const targetIdx = newItems.findIndex(i => i.id === targetId);
    const insertIdx = pos === 'below' ? targetIdx + 1 : targetIdx;
    newItems.splice(insertIdx, 0, draggedItem);
    onReorder(newItems);
  }, [items, onReorder]);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    performReorder(targetId, dropPosition);
    clearState();
  }, [dropPosition, performReorder, clearState]);

  const handleDragEnd = useCallback(() => {
    clearState();
  }, [clearState]);

  // --- Touch handlers (mobile) ---

  const handleTouchStart = useCallback((e: React.TouchEvent, id: string) => {
    e.preventDefault();
    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    
    longPressTimerRef.current = setTimeout(() => {
      draggedIdRef.current = id;
      touchActiveRef.current = true;
      setDraggingId(id);
      setIsTouchMode(true);
      startAutoScroll();
    }, LONG_PRESS_MS);
  }, [startAutoScroll]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];

    // If long-press hasn't fired yet, cancel if finger moved too far
    if (!touchActiveRef.current && longPressTimerRef.current) {
      const start = touchStartPosRef.current;
      if (start) {
        const dx = Math.abs(touch.clientX - start.x);
        const dy = Math.abs(touch.clientY - start.y);
        if (dx > 10 || dy > 10) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
          return;
        }
      }
    }

    if (!touchActiveRef.current) return;

    // Prevent scrolling during active drag
    e.preventDefault();

    // Feed pointer position to auto-scroll engine
    pointerYRef.current = touch.clientY;

    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const rowEl = el?.closest('[data-drag-id]') as HTMLElement | null;

    if (rowEl) {
      const targetId = rowEl.getAttribute('data-drag-id')!;
      if (targetId !== draggedIdRef.current) {
        const rect = rowEl.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const pos = touch.clientY < midpoint ? 'above' : 'below';
        dragOverIdRef.current = targetId;
        dropPositionRef.current = pos;
        setDragOverId(targetId);
        setDropPosition(pos);
      }
    } else {
      dragOverIdRef.current = null;
      dropPositionRef.current = null;
      setDragOverId(null);
      setDropPosition(null);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (touchActiveRef.current && dragOverIdRef.current && dropPositionRef.current) {
      performReorder(dragOverIdRef.current, dropPositionRef.current);
    }

    clearState();
  }, [performReorder, clearState]);

  const handleTouchCancel = useCallback(() => {
    clearState();
  }, [clearState]);

  const getDragProps = useCallback((id: string) => ({
    isDragging: draggingId === id,
    dropIndicator: dragOverId === id ? dropPosition : null,
    onRowDragStart: handleDragStart,
    onRowDragOver: handleDragOver,
    onRowDragLeave: handleDragLeave,
    onRowDrop: handleDrop,
    onRowDragEnd: handleDragEnd,
    onTouchDragStart: handleTouchStart,
    onTouchDragMove: handleTouchMove,
    onTouchDragEnd: handleTouchEnd,
    onTouchDragCancel: handleTouchCancel,
    isTouchDragging: isTouchMode && draggingId === id,
  }), [draggingId, dragOverId, dropPosition, isTouchMode, handleDragStart, handleDragOver, handleDragLeave, handleDrop, handleDragEnd, handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel]);

  return { getDragProps };
}
