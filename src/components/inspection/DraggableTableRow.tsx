import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { ReactNode } from "react";

interface DraggableTableRowProps {
  id: string;
  children: ReactNode;
  className?: string;
}

export function DraggableTableRow({ id, children, className = "" }: DraggableTableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id });

  const baseTransform = CSS.Transform.toString(transform);
  const style = {
    transform: baseTransform ? (isDragging ? `${baseTransform} scale(1.01)` : baseTransform) : undefined,
    transition: transition || 'transform 200ms ease, opacity 150ms ease, border-top 150ms ease',
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 50 : 'auto' as const,
    position: 'relative' as const,
    boxShadow: isDragging
      ? '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)'
      : 'none',
    background: isDragging ? 'hsl(var(--background))' : undefined,
    borderTop: isOver && !isDragging ? '3px solid hsl(var(--primary))' : undefined,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`${className} ${isOver && !isDragging ? 'bg-primary/5' : ''}`}
    >
      <td className="border p-2 text-center w-10">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing touch-none inline-flex items-center justify-center"
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
        </div>
      </td>
      {children}
    </tr>
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
    transition: transition || 'transform 200ms ease, opacity 150ms ease, border-top 150ms ease',
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 50 : 'auto' as const,
    boxShadow: isDragging
      ? '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)'
      : 'none',
    borderTop: isOver && !isDragging ? '3px solid hsl(var(--primary))' : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${isDragging ? 'ring-2 ring-primary ring-offset-2 shadow-xl rounded-lg' : ''} ${isOver && !isDragging ? 'bg-primary/5' : ''}`}
    >
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
