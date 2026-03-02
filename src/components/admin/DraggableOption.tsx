import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { GripVertical, Trash2 } from "lucide-react";

interface DraggableOptionProps {
  id: string;
  label: string;
  onDelete: () => void;
}

export const DraggableOption = ({ id, label, onDelete }: DraggableOptionProps) => {
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
      className={`flex items-center justify-between p-2 bg-muted rounded ${isDragging ? 'ring-2 ring-primary' : ''} ${isOver && !isDragging ? 'bg-primary/5' : ''}`}
    >
      <div className="flex items-center gap-2">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
        </div>
        <span className="text-sm">{label}</span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onDelete}
      >
        <Trash2 className="w-4 h-4 text-destructive" />
      </Button>
    </div>
  );
};
