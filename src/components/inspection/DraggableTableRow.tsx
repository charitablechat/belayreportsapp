import { GripVertical } from "lucide-react";
import { ReactNode, useRef, useEffect } from "react";

interface DraggableTableRowProps {
  id: string;
  children: ReactNode;
  className?: string;
  gridCols?: string;
  isDragging?: boolean;
  dropIndicator?: 'above' | 'below' | null;
  onRowDragStart: (e: React.DragEvent, id: string) => void;
  onRowDragOver: (e: React.DragEvent, id: string) => void;
  onRowDragLeave: () => void;
  onRowDrop: (e: React.DragEvent, id: string) => void;
  onRowDragEnd: () => void;
  onTouchDragStart?: (e: React.TouchEvent, id: string) => void;
  onTouchDragMove?: (e: React.TouchEvent) => void;
  onTouchDragEnd?: () => void;
  onTouchDragCancel?: () => void;
  isTouchDragging?: boolean;
}

export function DraggableTableRow({
  id, children, className = "", gridCols,
  isDragging, dropIndicator,
  onRowDragStart, onRowDragOver, onRowDragLeave, onRowDrop, onRowDragEnd,
  onTouchDragStart, onTouchDragMove, onTouchDragEnd, onTouchDragCancel,
  isTouchDragging,
}: DraggableTableRowProps) {
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

  return (
    <div
      ref={rowRef}
      data-drag-id={id}
      data-row-id={id}
      draggable={!isTouchDragging}
      onDragStart={(e) => onRowDragStart(e, id)}
      onDragOver={(e) => onRowDragOver(e, id)}
      onDragLeave={onRowDragLeave}
      onDrop={(e) => onRowDrop(e, id)}
      onDragEnd={onRowDragEnd}
      onTouchEnd={onTouchDragEnd}
      onTouchCancel={onTouchDragCancel}
      style={{
        opacity: isDragging ? 0.4 : 1,
        // NOTE (P1): do NOT set pointer-events:none on the whole row, even
        // during touch-drag. The grip handle uses touchAction:'none' to claim
        // the drag, and elementFromPoint in handleTouchMove handles drop
        // detection — blocking row pointer events here caused Type/Result
        // dropdowns inside the row to become un-tappable on touch devices
        // when a stale isTouchDragging flag persisted past an aborted drag.
        userSelect: 'none',
        WebkitTouchCallout: 'none',
      } as React.CSSProperties}
      className={`relative ${gridCols ? `grid ${gridCols}` : ''} border-b border-border bg-background ${className} ${isDragging ? 'border-dashed border-2 border-primary/30' : ''} ${dropIndicator === 'above' ? 'border-t-[3px] border-t-[#2563EB]' : ''} ${dropIndicator === 'below' ? 'border-b-[3px] border-b-[#2563EB]' : ''}`}
    >
      <div className="p-2 flex items-center justify-center border-r border-border">
        <div
          className={`inline-flex items-center justify-center ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ touchAction: 'none', userSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties}
          aria-label="Drag to reorder"
          onTouchStart={onTouchDragStart ? (e) => onTouchDragStart(e, id) : undefined}
          onContextMenu={(e) => e.preventDefault()}
        >
          <GripVertical className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
        </div>
      </div>
      {children}
    </div>
  );
}

interface DraggableMobileCardProps {
  id: string;
  children: ReactNode;
  isDragging?: boolean;
  dropIndicator?: 'above' | 'below' | null;
  onRowDragStart: (e: React.DragEvent, id: string) => void;
  onRowDragOver: (e: React.DragEvent, id: string) => void;
  onRowDragLeave: () => void;
  onRowDrop: (e: React.DragEvent, id: string) => void;
  onRowDragEnd: () => void;
  onTouchDragStart?: (e: React.TouchEvent, id: string) => void;
  onTouchDragMove?: (e: React.TouchEvent) => void;
  onTouchDragEnd?: () => void;
  onTouchDragCancel?: () => void;
  isTouchDragging?: boolean;
}

export function DraggableMobileCard({
  id, children, isDragging, dropIndicator,
  onRowDragStart, onRowDragOver, onRowDragLeave, onRowDrop, onRowDragEnd,
  onTouchDragStart, onTouchDragMove, onTouchDragEnd, onTouchDragCancel,
  isTouchDragging,
}: DraggableMobileCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || !onTouchDragMove) return;
    const handler = (e: TouchEvent) => {
      onTouchDragMove(e as unknown as React.TouchEvent);
    };
    el.addEventListener('touchmove', handler, { passive: false });
    return () => el.removeEventListener('touchmove', handler);
  }, [onTouchDragMove]);

  return (
    <div
      ref={cardRef}
      data-drag-id={id}
      data-row-id={id}
      draggable={false}
      onDragStart={(e) => onRowDragStart(e, id)}
      onDragOver={(e) => onRowDragOver(e, id)}
      onDragLeave={onRowDragLeave}
      onDrop={(e) => onRowDrop(e, id)}
      onDragEnd={onRowDragEnd}
      onTouchEnd={onTouchDragEnd}
      onTouchCancel={onTouchDragCancel}
      style={{
        opacity: isDragging ? 0.4 : 1,
        pointerEvents: isTouchDragging ? 'none' : undefined,
        userSelect: 'none',
        WebkitTouchCallout: 'none',
      } as React.CSSProperties}
      className={`relative ${isDragging ? 'border-dashed border-2 border-primary/30 rounded-lg' : ''} ${dropIndicator === 'above' ? 'border-t-[3px] border-t-[#2563EB]' : ''} ${dropIndicator === 'below' ? 'border-b-[3px] border-b-[#2563EB]' : ''}`}
    >
      <div className="relative">
        <div
          className={`absolute top-3 left-3 z-10 p-1.5 bg-background/90 backdrop-blur-sm rounded-md shadow-sm border border-border hover:bg-accent transition-colors ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ touchAction: 'none', userSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties}
          aria-label="Drag to reorder"
          onTouchStart={onTouchDragStart ? (e) => onTouchDragStart(e, id) : undefined}
          onContextMenu={(e) => e.preventDefault()}
        >
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </div>
        {children}
      </div>
    </div>
  );
}
