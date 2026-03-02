import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { ReactNode } from "react";

interface DraggableFieldProps {
  id: string;
  children: ReactNode;
}

export const DraggableField = ({ id, children }: DraggableFieldProps) => {
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
    transition,
    opacity: isDragging ? 0.8 : 1,
    boxShadow: isDragging
      ? '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)'
      : 'none',
    borderTop: isOver && !isDragging ? '2px solid hsl(var(--primary))' : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-4 border rounded-lg space-y-3 bg-card ${isDragging ? 'ring-2 ring-primary' : ''} ${isOver && !isDragging ? 'bg-primary/5' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing touch-none mt-1"
        >
          <GripVertical className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
        </div>
        <div className="flex-1">
          {children}
        </div>
      </div>
    </div>
  );
};
