import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { differenceInDays, isWithinInterval, startOfWeek, endOfWeek, startOfMonth, endOfMonth, endOfDay, parseISO } from "date-fns";
import { getReportDate, getAssigneeName } from "@/lib/report-utils";
import { getReportAgeState, type ReportAgeState } from "@/components/dashboard/ReportCard";
import { loadInitialViewMode, persistViewMode, fetchRemoteViewMode } from "@/lib/dashboard-view-mode";

export type SortOption = 'priority' | 'completed' | 'date-asc' | 'date-desc' | 'title-az' | 'assignee';
export type GroupOption = 'none' | 'status' | 'date' | 'assignee' | 'region';
export type ViewMode = 'grid' | 'list' | 'split';
export type SyncFilter = 'all' | 'synced' | 'local';

export interface DashboardFilterState {
  search: string;
  statusFilter: string;
  assigneeFilter: string[];
  dateRange: { from?: Date; to?: Date };
  syncFilter: SyncFilter;
  alphabeticalFilter: string;
  facilityFilter: string;
  quickFilters: {
    myCards: boolean;
    dueThisWeek: boolean;
    draftsOnly: boolean;
    needsAttention: boolean;
  };
  sortBy: SortOption;
  groupBy: GroupOption;
  viewMode: ViewMode;
  page: number;
}

export interface GroupedReports {
  label: string;
  count: number;
  items: any[];
  isCollapsed?: boolean;
}

const GRID_PAGE_SIZE = 24;
const LIST_PAGE_SIZE = 50;

function tierOf(r: any): number {
  if (r.status === 'completed') return 3;
  // Guard against missing/invalid dates — default to critical to avoid hiding overdue reports
  const createdAt = r.created_at ? new Date(r.created_at) : null;
  if (!createdAt || isNaN(createdAt.getTime())) return 0; // critical — safer to over-escalate
  const age = differenceInDays(new Date(), createdAt);
  if (age > 5) return 0; // critical
  if (age > 3) return 1; // warning
  return 2; // default
}

function getOrganization(report: any): string {
  return report.organization || '';
}

function getLocation(report: any): string {
  return report.location || '';
}

function getRegion(report: any): string {
  const loc = report.location || '';
  // Try to extract state from "City, State" pattern
  const parts = loc.split(',').map((s: string) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 1] : loc || 'Unknown';
}

export function useDashboardFilters(
  reports: any[],
  type: string,
  currentUserId: string | null,
  isSuperAdmin: boolean = false,
  profilesById?: ReadonlyMap<string, { first_name: string | null; last_name: string | null }> | null,
) {
  const [filters, setFilters] = useState<DashboardFilterState>({
    search: '',
    statusFilter: 'all',
    assigneeFilter: [],
    dateRange: {},
    syncFilter: 'all',
    alphabeticalFilter: '',
    facilityFilter: '',
    quickFilters: { myCards: false, dueThisWeek: false, draftsOnly: false, needsAttention: false },
    sortBy: 'priority',
    groupBy: 'none',
    viewMode: loadInitialViewMode(),
    page: 1,
  });

  const [completedCollapsed, setCompletedCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const updateFilter = useCallback(<K extends keyof DashboardFilterState>(
    key: K,
    value: DashboardFilterState[K]
  ) => {
    setFilters(prev => ({ ...prev, [key]: value, page: key !== 'page' ? 1 : (value as number) }));
  }, []);

  const toggleQuickFilter = useCallback((key: keyof DashboardFilterState['quickFilters']) => {
    setFilters(prev => ({
      ...prev,
      page: 1,
      quickFilters: { ...prev.quickFilters, [key]: !prev.quickFilters[key] },
    }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters(prev => ({
      ...prev,
      search: '',
      statusFilter: 'all',
      assigneeFilter: [],
      dateRange: {},
      syncFilter: 'all',
      alphabeticalFilter: '',
      facilityFilter: '',
      quickFilters: { myCards: false, dueThisWeek: false, draftsOnly: false, needsAttention: false },
      page: 1,
    }));
  }, []);

  const toggleGroupCollapse = useCallback((label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const hasActiveFilters = useMemo(() => {
    const { search, statusFilter, assigneeFilter, dateRange, syncFilter, quickFilters, alphabeticalFilter, facilityFilter } = filters;
    return !!(
      search ||
      statusFilter !== 'all' ||
      assigneeFilter.length > 0 ||
      dateRange.from ||
      dateRange.to ||
      syncFilter !== 'all' ||
      alphabeticalFilter ||
      facilityFilter ||
      quickFilters.myCards ||
      quickFilters.dueThisWeek ||
      quickFilters.draftsOnly ||
      quickFilters.needsAttention
    );
  }, [filters]);

  const result = useMemo(() => {
    let filtered = [...reports];
    const { search, statusFilter, assigneeFilter, dateRange, syncFilter, quickFilters, sortBy, groupBy, viewMode, page, alphabeticalFilter, facilityFilter } = filters;

    // 1. Text search
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(r =>
        getOrganization(r).toLowerCase().includes(q) ||
        getLocation(r).toLowerCase().includes(q) ||
        getAssigneeName(r, type, profilesById ?? undefined).toLowerCase().includes(q)
      );
    }

    // 1b. Alphabetical filter
    if (alphabeticalFilter) {
      filtered = filtered.filter(r => getOrganization(r).toUpperCase().startsWith(alphabeticalFilter));
    }

    // 1c. Facility filter
    if (facilityFilter) {
      filtered = filtered.filter(r => getLocation(r) === facilityFilter);
    }

    // 2. Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(r => r.status === statusFilter);
    }

    // 3. Assignee filter
    if (assigneeFilter.length > 0) {
      filtered = filtered.filter(r => assigneeFilter.includes(r.inspector_id));
    }

    // 4. Date range (normalize to end-of-day for inclusive boundary)
    if (dateRange.from || dateRange.to) {
      const toEndOfDay = dateRange.to ? endOfDay(dateRange.to) : undefined;
      filtered = filtered.filter(r => {
        const d = getReportDate(r, type);
        if (!d) return false;
        const date = new Date(d);
        if (dateRange.from && date < dateRange.from) return false;
        if (toEndOfDay && date > toEndOfDay) return false;
        return true;
      });
    }

    // 5. Sync filter
    if (syncFilter === 'synced') {
      filtered = filtered.filter(r => !!r.synced_at);
    } else if (syncFilter === 'local') {
      filtered = filtered.filter(r => !r.synced_at);
    }

    // 6. Quick filters (AND logic)
    if (quickFilters.myCards && currentUserId) {
      filtered = filtered.filter(r => r.inspector_id === currentUserId);
    }
    if (quickFilters.dueThisWeek) {
      const weekStart = startOfWeek(new Date());
      const weekEnd = endOfWeek(new Date());
      filtered = filtered.filter(r => {
        if (r.status === 'completed') return false;
        const d = getReportDate(r, type);
        if (!d) return true; // drafts without dates
        try {
          return isWithinInterval(new Date(d), { start: weekStart, end: weekEnd });
        } catch {
          return false;
        }
      });
    }
    if (quickFilters.draftsOnly) {
      filtered = filtered.filter(r => r.status === 'draft');
    }
    if (quickFilters.needsAttention) {
      filtered = filtered.filter(r => {
        const t = tierOf(r);
        return t === 0 || t === 1;
      });
    }

    // 7. Sort - critical always first regardless of sort mode
    const sortFn = (a: any, b: any): number => {
      // Primary: critical tier always wins
      const ta = tierOf(a);
      const tb = tierOf(b);
      if (ta <= 1 || tb <= 1) {
        // At least one is critical/warning — sort by tier first
        if (ta !== tb) return ta - tb;
      }

      switch (sortBy) {
        case 'priority':
          if (ta !== tb) return ta - tb;
          return 0;
        case 'completed': {
          // Completed (tier 3) floats up after critical/warning
          if (ta !== tb) {
            if (ta === 3 && tb !== 3) return -1;
            if (tb === 3 && ta !== 3) return 1;
            return ta - tb;
          }
          // Within completed, sort by date descending
          const dc = getReportDate(a, type) || '';
          const dd = getReportDate(b, type) || '';
          return dd.localeCompare(dc);
        }
        case 'date-asc': {
          const da = getReportDate(a, type) || '';
          const db = getReportDate(b, type) || '';
          return da.localeCompare(db);
        }
        case 'date-desc': {
          const da = getReportDate(a, type) || '';
          const db = getReportDate(b, type) || '';
          return db.localeCompare(da);
        }
        case 'title-az':
          return getOrganization(a).localeCompare(getOrganization(b));
        case 'assignee':
          return getAssigneeName(a, type, profilesById ?? undefined).localeCompare(getAssigneeName(b, type, profilesById ?? undefined));
        default:
          return 0;
      }
    };

    filtered.sort(sortFn);

    // 7b. "Completed" sort: show only last 9 completed reports
    if (sortBy === 'completed') {
      let completed = filtered.filter(r => r.status === 'completed');
      if (!isSuperAdmin && currentUserId) {
        completed = completed.filter(r => r.inspector_id === currentUserId);
      }
      completed.sort((a: any, b: any) => {
        const da = getReportDate(a, type) || '';
        const db = getReportDate(b, type) || '';
        return db.localeCompare(da);
      });
      completed = completed.slice(0, 10);
      return {
        groups: [{ label: 'Last 10 Completed', count: completed.length, items: completed }],
        totalItems: completed.length,
        totalPages: 1,
        currentPage: 1,
        filteredCount: completed.length,
        criticalCount: 0,
        warningCount: 0,
      };
    }

    // 8. Separate completed into bottom section
    const criticalItems = filtered.filter(r => tierOf(r) === 0);
    const warningItems = filtered.filter(r => tierOf(r) === 1);
    const activeItems = filtered.filter(r => tierOf(r) === 2);
    const completedItems = filtered.filter(r => tierOf(r) === 3);

    // 9. Grouping
    let groups: GroupedReports[] = [];
    const needsAttentionItems = [...criticalItems, ...warningItems];
    const nonAttentionActive = activeItems;

    if (groupBy === 'none') {
      // Flat list: attention first, then active, then completed collapsed
      const mainItems = [...needsAttentionItems, ...nonAttentionActive];
      if (mainItems.length > 0) {
        groups.push({ label: 'Drafts', count: mainItems.length, items: mainItems });
      }
      if (completedItems.length > 0) {
        groups.push({ label: 'Completed', count: completedItems.length, items: completedItems, isCollapsed: completedCollapsed });
      }
    } else {
      // Always add Needs Attention group first
      if (needsAttentionItems.length > 0) {
        groups.push({ label: '⚠️ Needs Attention', count: needsAttentionItems.length, items: needsAttentionItems });
      }

      // Group the remaining active items
      const allActive = nonAttentionActive;
      const groupMap = new Map<string, any[]>();

      for (const r of allActive) {
        let key = '';
        switch (groupBy) {
          case 'status':
            key = r.status || 'Unknown';
            break;
          case 'date': {
            const d = getReportDate(r, type);
            if (!d) { key = 'No Date'; break; }
            const date = new Date(d);
            const now = new Date();
            const weekEnd = endOfWeek(now);
            const monthEnd = endOfMonth(now);
            if (date <= weekEnd) key = 'This Week';
            else if (date <= monthEnd) key = 'This Month';
            else if (date > now) key = 'Upcoming';
            else key = 'Past';
            break;
          }
          case 'assignee':
            key = getAssigneeName(r, type, profilesById ?? undefined);
            break;
          case 'region':
            key = getRegion(r);
            break;
        }
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(r);
      }

      for (const [label, items] of groupMap) {
        groups.push({ label, count: items.length, items, isCollapsed: collapsedGroups.has(label) });
      }

      // Completed at bottom
      if (completedItems.length > 0) {
        groups.push({ label: 'Completed', count: completedItems.length, items: completedItems, isCollapsed: completedCollapsed });
      }
    }

    // 10. Pagination
    // Pagination is driven ONLY by the paginatable (non-completed) groups.
    // The Completed section is always rendered in full at the bottom and
    // must not contribute to totalPages — otherwise Next/Previous appears
    // to do nothing when most reports are completed.
    const pageSize = viewMode === 'grid' ? GRID_PAGE_SIZE : LIST_PAGE_SIZE;

    const completedGroup = groups.find(g => g.label === 'Completed');
    const paginatableGroups = groups.filter(g => g.label !== 'Completed');
    const paginatableItems = paginatableGroups.flatMap(g => g.items);
    const totalItems = paginatableItems.length + (completedGroup?.items.length ?? 0);
    const totalPages = Math.max(1, Math.ceil(paginatableItems.length / pageSize));
    const currentPage = Math.min(Math.max(1, page), totalPages);

    let paginatedGroups: GroupedReports[] = [];
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;

    if (groupBy === 'none') {
      // Flat list: slice the single main group by page.
      const mainGroup = paginatableGroups[0];
      if (mainGroup) {
        const pageItems = mainGroup.items.slice(startIdx, endIdx);
        paginatedGroups.push({ ...mainGroup, items: pageItems, count: mainGroup.count });
      }
    } else {
      // Grouped mode: walk groups in order and slice into the page window.
      let cursor = 0;
      for (const g of paginatableGroups) {
        const groupStart = cursor;
        const groupEnd = cursor + g.items.length;
        cursor = groupEnd;
        if (groupEnd <= startIdx) continue;
        if (groupStart >= endIdx) break;
        const localStart = Math.max(0, startIdx - groupStart);
        const localEnd = Math.min(g.items.length, endIdx - groupStart);
        paginatedGroups.push({ ...g, items: g.items.slice(localStart, localEnd), count: g.count });
      }
    }

    // Always append the completed group unchanged, regardless of page.
    if (completedGroup) {
      paginatedGroups.push(completedGroup);
    }

    return {
      groups: paginatedGroups,
      totalItems,
      totalPages,
      currentPage,
      filteredCount: filtered.length,
      criticalCount: criticalItems.length,
      warningCount: warningItems.length,
    };
  }, [reports, filters, type, currentUserId, isSuperAdmin, completedCollapsed, collapsedGroups, profilesById]);

  return {
    filters,
    updateFilter,
    toggleQuickFilter,
    clearAllFilters,
    completedCollapsed,
    setCompletedCollapsed,
    toggleGroupCollapse,
    collapsedGroups,
    hasActiveFilters,
    ...result,
  };
}
