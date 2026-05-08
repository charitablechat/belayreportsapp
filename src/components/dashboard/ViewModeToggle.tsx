import { Button } from "@/components/ui/button";
import { LayoutGrid, List, Columns2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/hooks/useDashboardFilters";

interface ViewModeToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  className?: string;
}

export function ViewModeToggle({ viewMode, onViewModeChange, className }: ViewModeToggleProps) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };
  return (
    <div className={cn("flex border rounded-md overflow-hidden", className)} onClick={(e) => e.stopPropagation()}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="List"
        className={cn("h-8 w-8 rounded-none", viewMode === 'list' && "bg-accent")}
        onClick={stop(() => onViewModeChange('list'))}
      >
        <List className="w-4 h-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Split"
        className={cn("h-8 w-8 rounded-none", viewMode === 'split' && "bg-accent")}
        onClick={stop(() => onViewModeChange('split'))}
      >
        <Columns2 className="w-4 h-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Grid"
        className={cn("h-8 w-8 rounded-none", viewMode === 'grid' && "bg-accent")}
        onClick={stop(() => onViewModeChange('grid'))}
      >
        <LayoutGrid className="w-4 h-4" />
      </Button>
    </div>
  );
}
