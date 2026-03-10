import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { SyncFilter } from "@/hooks/useDashboardFilters";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

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
  alphabeticalFilter: string;
  onAlphabeticalChange: (v: string) => void;
  facilityFilter: string;
  onFacilityChange: (v: string) => void;
  uniqueFacilities: string[];
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
  alphabeticalFilter,
  onAlphabeticalChange,
  facilityFilter,
  onFacilityChange,
  uniqueFacilities,
}: DashboardFiltersProps) {
  const statusOptions = ['all', ...statuses];

  return (
    <div className="space-y-2">
      {/* A-Z letter chips */}
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex gap-1 pb-1">
          <button
            onClick={() => onAlphabeticalChange('')}
            aria-pressed={alphabeticalFilter === ''}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium transition-colors border flex-shrink-0",
              alphabeticalFilter === ''
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted text-muted-foreground border-border hover:bg-accent"
            )}
          >
            All
          </button>
          {LETTERS.map((letter) => (
            <button
              key={letter}
              onClick={() => onAlphabeticalChange(alphabeticalFilter === letter ? '' : letter)}
              aria-pressed={alphabeticalFilter === letter}
              className={cn(
                "w-7 h-7 rounded-full text-xs font-medium transition-colors border flex-shrink-0 flex items-center justify-center",
                alphabeticalFilter === letter
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-border hover:bg-accent"
              )}
            >
              {letter}
            </button>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Existing filters row */}
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

        {/* Facility dropdown */}
        {uniqueFacilities.length > 0 && (
          <Select
            value={facilityFilter || "all"}
            onValueChange={(v) => onFacilityChange(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="All Facilities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Facilities</SelectItem>
              {uniqueFacilities.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

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
    </div>
  );
}
