import { useState, useRef, useCallback } from "react";

export function useNativeDrag<T extends { id: string }>(
  items: T[],
  onReorder: (reordered: T[]) => void,
) {
  const draggedIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'above' | 'below' | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    draggedIdRef.current = id;
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
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

  const clearState = useCallback(() => {
    draggedIdRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
    setDropPosition(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const dragId = draggedIdRef.current;
    if (!dragId || dragId === targetId) { clearState(); return; }

    const newItems = [...items];
    const dragIdx = newItems.findIndex(i => i.id === dragId);
    if (dragIdx === -1) { clearState(); return; }
    const [draggedItem] = newItems.splice(dragIdx, 1);
    const targetIdx = newItems.findIndex(i => i.id === targetId);
    const insertIdx = dropPosition === 'below' ? targetIdx + 1 : targetIdx;
    newItems.splice(insertIdx, 0, draggedItem);
    onReorder(newItems);
    clearState();
  }, [items, dropPosition, onReorder, clearState]);

  const handleDragEnd = useCallback(() => {
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
  }), [draggingId, dragOverId, dropPosition, handleDragStart, handleDragOver, handleDragLeave, handleDrop, handleDragEnd]);

  return { getDragProps };
}
