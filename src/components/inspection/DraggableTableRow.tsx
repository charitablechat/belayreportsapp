import { useSortable } from "@dnd-kit/sortable";
import { GripVertical } from "lucide-react";
import { ReactNode } from "react";

interface DraggableTableRowProps {
  id: string;
  children: ReactNode;
  className?: string;
  gridCols: string;
  isDropTarget?: boolean;
}

export function DraggableTableRow({ id, children, className = "", gridCols, isDropTarget = false }: DraggableTableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: undefined,
    transition: undefined,
    opacity: isDragging ? 0.15 : 1,
    zIndex: isDragging ? 50 : ('auto' as const),
    boxShadow: isDragging
      ? '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)'
      : 'none',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative grid ${gridCols} border-b border-border bg-background ${className} ${isDragging ? 'ring-2 ring-primary ring-offset-2 rounded' : ''}`}
    >
      {isDropTarget && !isDragging && (
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary rounded-full -translate-y-1/2 z-10 shadow-[0_0_6px_hsl(var(--primary)/0.5)]" />
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
  isDropTarget?: boolean;
}

export function DraggableMobileCard({ id, children, isDropTarget = false }: DraggableMobileCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: undefined,
    transition: undefined,
    opacity: isDragging ? 0.15 : 1,
    zIndex: isDragging ? 50 : ('auto' as const),
    boxShadow: isDragging
      ? '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)'
      : 'none',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative ${isDragging ? 'ring-2 ring-primary ring-offset-2 rounded-lg' : ''}`}
    >
      {isDropTarget && !isDragging && (
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary rounded-full -translate-y-1/2 z-10 shadow-[0_0_6px_hsl(var(--primary)/0.5)]" />
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
