import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { ReactNode } from "react";

interface DraggableTableRowProps {
  id: string;
  children: ReactNode;
  className?: string;
  gridCols: string;
}

export function DraggableTableRow({ id, children, className = "", gridCols }: DraggableTableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 200ms ease',
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 50 : 'auto' as const,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative overflow-visible grid ${gridCols} border-b border-border bg-background ${className} ${isDragging ? 'bg-muted/50 border-dashed border-2 border-primary/30' : ''}`}
    >
      {isOver && !isDragging && (
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary z-50 -translate-y-1/2 rounded-full shadow-[0_0_8px_2px_hsl(var(--primary)/0.4)] animate-pulse" />
      )}
      <div className="p-2 flex items-center justify-center border-r border-border">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing touch-none inline-flex items-center justify-center"
          aria-label="Drag to reorder"
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
}

export function DraggableMobileCard({ id, children }: DraggableMobileCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 200ms ease',
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 50 : 'auto' as const,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative overflow-visible ${isDragging ? 'bg-muted/50 border-dashed border-2 border-primary/30 rounded-lg' : ''}`}
    >
      {isOver && !isDragging && (
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary z-50 -translate-y-1/2 rounded-full shadow-[0_0_8px_2px_hsl(var(--primary)/0.4)] animate-pulse" />
      )}
      <div className="relative">
        <div
          {...attributes}
          {...listeners}
          className="absolute top-3 left-3 z-10 p-1.5 bg-background/90 backdrop-blur-sm rounded-md cursor-grab active:cursor-grabbing touch-none shadow-sm border border-border hover:bg-accent transition-colors"
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </div>
        {children}
      </div>
    </div>
  );
}
