import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LayoutGrid, List, Columns2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortOption, GroupOption, ViewMode } from "@/hooks/useDashboardFilters";

interface DashboardControlsProps {
  sortBy: SortOption;
  onSortChange: (v: SortOption) => void;
  groupBy: GroupOption;
  onGroupChange: (v: GroupOption) => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
}

export function DashboardControls({
  sortBy, onSortChange,
  groupBy, onGroupChange,
  viewMode, onViewModeChange,
}: DashboardControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={groupBy} onValueChange={(v) => onGroupChange(v as GroupOption)}>
        <SelectTrigger className="w-[140px] h-8 text-xs">
          <SelectValue placeholder="Group by" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No Grouping</SelectItem>
          <SelectItem value="status">Status</SelectItem>
          <SelectItem value="date">Date</SelectItem>
          <SelectItem value="assignee">Inspector/Trainer</SelectItem>
          <SelectItem value="region">Region / State</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sortBy} onValueChange={(v) => onSortChange(v as SortOption)}>
        <SelectTrigger className="w-[140px] h-8 text-xs">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="priority">Priority</SelectItem>
          <SelectItem value="completed">Completed</SelectItem>
          <SelectItem value="date-asc">Date ↑</SelectItem>
          <SelectItem value="date-desc">Date ↓</SelectItem>
          <SelectItem value="title-az">Title A–Z</SelectItem>
          <SelectItem value="assignee">Inspector/Trainer</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex border rounded-md overflow-hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label="List"
          className={cn("h-8 w-8 rounded-none", viewMode === 'list' && "bg-accent")}
          onClick={() => onViewModeChange('list')}
        >
          <List className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Split"
          className={cn("h-8 w-8 rounded-none", viewMode === 'split' && "bg-accent")}
          onClick={() => onViewModeChange('split')}
        >
          <Columns2 className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Grid"
          className={cn("h-8 w-8 rounded-none", viewMode === 'grid' && "bg-accent")}
          onClick={() => onViewModeChange('grid')}
        >
          <LayoutGrid className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
