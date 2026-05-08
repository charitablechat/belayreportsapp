import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SortOption, GroupOption } from "@/hooks/useDashboardFilters";

interface DashboardControlsProps {
  sortBy: SortOption;
  onSortChange: (v: SortOption) => void;
  groupBy: GroupOption;
  onGroupChange: (v: GroupOption) => void;
}

export function DashboardControls({
  sortBy, onSortChange,
  groupBy, onGroupChange,
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
    </div>
  );
}
