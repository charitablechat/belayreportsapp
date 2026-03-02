import { useSortable } from "@dnd-kit/sortable";
import { GripVertical } from "lucide-react";
import { ReactNode } from "react";

interface DraggableTableRowProps {
  id: string;
  children: ReactNode;
  className?: string;
  isDropTarget?: boolean;
  isDragActive?: boolean;
}

export function DraggableTableRow({ id, children, className = "", isDropTarget = false, isDragActive = false }: DraggableTableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
  } = useSortable({ id });

  return (
    <tr
      ref={setNodeRef}
      style={{
        opacity: isDragActive ? 0.15 : 1,
        position: 'relative' as const,
        background: isDragActive
          ? 'hsl(var(--muted) / 0.5)'
          : isDropTarget
            ? 'hsl(var(--primary) / 0.08)'
            : undefined,
      }}
      className={`${className} ${isDragActive ? 'pointer-events-none' : ''}`}
    >
      <td
        className="border p-2 text-center w-10"
        style={{ position: 'relative', overflow: 'visible' }}
      >
        {isDropTarget && (
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
  isDropTarget?: boolean;
  isDragActive?: boolean;
}

export function DraggableMobileCard({ id, children, isDropTarget = false, isDragActive = false }: DraggableMobileCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        opacity: isDragActive ? 0.15 : 1,
        background: isDragActive
          ? 'hsl(var(--muted) / 0.5)'
          : isDropTarget
            ? 'hsl(var(--primary) / 0.08)'
            : undefined,
      }}
      className={`${isDragActive ? 'rounded-lg pointer-events-none' : ''}`}
    >
      <div className="relative">
        {isDropTarget && (
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
