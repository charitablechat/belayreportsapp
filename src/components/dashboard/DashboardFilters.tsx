import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { SyncFilter } from "@/hooks/useDashboardFilters";

interface DashboardFiltersProps {
  statusFilter: string;
  onStatusChange: (v: string) => void;
  assigneeFilter: string[];
  onAssigneeChange: (v: string[]) => void;
  dateRange: { from?: Date; to?: Date };
  onDateRangeChange: (v: { from?: Date; to?: Date }) => void;
  syncFilter: SyncFilter;
  onSyncChange: (v: SyncFilter) => void;
  uniqueInspectors: { id: string; name: string }[];
  statuses: string[];
}

export function DashboardFilters({
  statusFilter,
  onStatusChange,
  assigneeFilter,
  onAssigneeChange,
  dateRange,
  onDateRangeChange,
  syncFilter,
  onSyncChange,
  uniqueInspectors,
  statuses,
}: DashboardFiltersProps) {
  const statusOptions = ['all', ...statuses];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Status pills */}
      <div className="flex gap-1">
        {statusOptions.map((s) => (
          <button
            key={s}
            onClick={() => onStatusChange(s)}
            aria-pressed={statusFilter === s}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium transition-colors border",
              statusFilter === s
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted text-muted-foreground border-border hover:bg-accent"
            )}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Assignee multi-select */}
      {uniqueInspectors.length > 1 && (
        <Select
          value={assigneeFilter.length === 1 ? assigneeFilter[0] : "all"}
          onValueChange={(v) => onAssigneeChange(v === "all" ? [] : [v])}
        >
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue placeholder="All Assignees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Assignees</SelectItem>
            {uniqueInspectors.map(({ id, name }) => (
              <SelectItem key={id} value={id}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Date Range */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
            <CalendarIcon className="w-3 h-3" />
            {dateRange.from ? (
              dateRange.to ? `${format(dateRange.from, "MMM d")} - ${format(dateRange.to, "MMM d")}` : format(dateRange.from, "MMM d, yyyy")
            ) : "Date Range"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={dateRange.from ? { from: dateRange.from, to: dateRange.to } : undefined}
            onSelect={(range) => onDateRangeChange({ from: range?.from, to: range?.to })}
            className="p-3 pointer-events-auto"
            numberOfMonths={1}
          />
          {dateRange.from && (
            <div className="px-3 pb-3">
              <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => onDateRangeChange({})}>
                Clear dates
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Sync Filter */}
      <Select value={syncFilter} onValueChange={(v) => onSyncChange(v as SyncFilter)}>
        <SelectTrigger className="w-[110px] h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Sync</SelectItem>
          <SelectItem value="synced">Synced</SelectItem>
          <SelectItem value="local">Local Only</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
