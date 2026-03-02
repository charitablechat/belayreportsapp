import { GripVertical } from "lucide-react";
import { ReactNode } from "react";

interface DraggableTableRowProps {
  id: string;
  children: ReactNode;
  className?: string;
  gridCols: string;
  isDragging?: boolean;
  dropIndicator?: 'above' | 'below' | null;
  onRowDragStart: (e: React.DragEvent, id: string) => void;
  onRowDragOver: (e: React.DragEvent, id: string) => void;
  onRowDragLeave: () => void;
  onRowDrop: (e: React.DragEvent, id: string) => void;
  onRowDragEnd: () => void;
}

export function DraggableTableRow({
  id, children, className = "", gridCols,
  isDragging, dropIndicator,
  onRowDragStart, onRowDragOver, onRowDragLeave, onRowDrop, onRowDragEnd,
}: DraggableTableRowProps) {
  return (
    <div
      draggable
      onDragStart={(e) => onRowDragStart(e, id)}
      onDragOver={(e) => onRowDragOver(e, id)}
      onDragLeave={onRowDragLeave}
      onDrop={(e) => onRowDrop(e, id)}
      onDragEnd={onRowDragEnd}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      className={`relative grid ${gridCols} border-b border-border bg-background ${className} ${isDragging ? 'border-dashed border-2 border-primary/30' : ''} ${dropIndicator === 'above' ? 'border-t-[3px] border-t-[#2563EB]' : ''} ${dropIndicator === 'below' ? 'border-b-[3px] border-b-[#2563EB]' : ''}`}
    >
      <div className="p-2 flex items-center justify-center border-r border-border">
        <div
          className={`inline-flex items-center justify-center ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
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
  isDragging?: boolean;
  dropIndicator?: 'above' | 'below' | null;
  onRowDragStart: (e: React.DragEvent, id: string) => void;
  onRowDragOver: (e: React.DragEvent, id: string) => void;
  onRowDragLeave: () => void;
  onRowDrop: (e: React.DragEvent, id: string) => void;
  onRowDragEnd: () => void;
}

export function DraggableMobileCard({
  id, children, isDragging, dropIndicator,
  onRowDragStart, onRowDragOver, onRowDragLeave, onRowDrop, onRowDragEnd,
}: DraggableMobileCardProps) {
  return (
    <div
      draggable
      onDragStart={(e) => onRowDragStart(e, id)}
      onDragOver={(e) => onRowDragOver(e, id)}
      onDragLeave={onRowDragLeave}
      onDrop={(e) => onRowDrop(e, id)}
      onDragEnd={onRowDragEnd}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      className={`relative ${isDragging ? 'border-dashed border-2 border-primary/30 rounded-lg' : ''} ${dropIndicator === 'above' ? 'border-t-[3px] border-t-[#2563EB]' : ''} ${dropIndicator === 'below' ? 'border-b-[3px] border-b-[#2563EB]' : ''}`}
    >
      <div className="relative">
        <div
          className={`absolute top-3 left-3 z-10 p-1.5 bg-background/90 backdrop-blur-sm rounded-md shadow-sm border border-border hover:bg-accent transition-colors ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </div>
        {children}
      </div>
    </div>
  );
}
