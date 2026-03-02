import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { ReactNode } from "react";

interface DraggablePhotoItemProps {
  id: string;
  children: ReactNode;
  disabled?: boolean;
}

export const DraggablePhotoItem = ({ id, children, disabled = false }: DraggablePhotoItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 200ms ease',
    opacity: isDragging ? 0.8 : 1,
    zIndex: isDragging ? 50 : 'auto',
    boxShadow: isDragging
      ? '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)'
      : 'none',
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      className={`relative ${isDragging ? 'ring-2 ring-primary ring-offset-2' : ''} ${isOver && !isDragging ? 'ring-2 ring-primary bg-primary/5' : ''}`}
    >
      {!disabled && (
        <div
          {...attributes}
          {...listeners}
          className="absolute top-2 left-2 z-10 p-1.5 bg-background/90 backdrop-blur-sm rounded-md cursor-grab active:cursor-grabbing touch-none shadow-sm border border-border hover:bg-accent transition-colors"
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
      {children}
    </div>
  );
};
