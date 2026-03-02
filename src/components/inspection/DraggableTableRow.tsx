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

  return (
    <tr
      ref={setNodeRef}
      style={{
        transform: isDragging ? 'none' : (baseTransform || undefined),
        transition: transition || 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1), opacity 150ms ease',
        opacity: isDragging ? 0.15 : 1,
        zIndex: isDragging ? 50 : 'auto' as const,
        position: 'relative' as const,
        background: isDragging
          ? 'hsl(var(--muted) / 0.5)'
          : isOver && !isDragging
            ? 'hsl(var(--primary) / 0.08)'
            : undefined,
      }}
      className={`${className} ${isDragging ? 'pointer-events-none' : ''}`}
    >
      <td
        className="border p-2 text-center w-10"
        style={{ position: 'relative', overflow: 'visible' }}
      >
        {/* Rendered drop indicator bar — immune to border-collapse clipping */}
        {isOver && !isDragging && (
          <div
            style={{
              position: 'absolute',
              top: -2,
              left: -1,
              height: 4,
              width: '200vw',
              background: 'hsl(var(--primary))',
              boxShadow: '0 0 8px hsl(var(--primary) / 0.5)',
              zIndex: 50,
              pointerEvents: 'none',
              borderRadius: 2,
            }}
          />
        )}
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

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: isDragging ? 'none' : (CSS.Transform.toString(transform) || undefined),
        transition: transition || 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1), opacity 150ms ease',
        opacity: isDragging ? 0.15 : 1,
        zIndex: isDragging ? 50 : 'auto' as const,
        background: isDragging
          ? 'hsl(var(--muted) / 0.5)'
          : isOver && !isDragging
            ? 'hsl(var(--primary) / 0.08)'
            : undefined,
      }}
      className={`${isDragging ? 'rounded-lg pointer-events-none' : ''}`}
    >
      <div className="relative">
        {/* Rendered drop indicator bar for mobile */}
        {isOver && !isDragging && (
          <div
            style={{
              position: 'absolute',
              top: -2,
              left: 0,
              right: 0,
              height: 4,
              background: 'hsl(var(--primary))',
              boxShadow: '0 0 8px hsl(var(--primary) / 0.5)',
              zIndex: 50,
              pointerEvents: 'none',
              borderRadius: 2,
            }}
          />
        )}
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
