import { useMemo, useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FileText, GraduationCap, ChevronDown, ChevronRight, X, Filter, Minimize2, Maximize2, Search, Receipt } from "lucide-react";
import { ReportCard } from "@/components/dashboard/ReportCard";
import { ReportCardSkeleton } from "@/components/dashboard/ReportCardSkeleton";
import { ReportListView } from "@/components/dashboard/ReportListView";
import { DashboardSearchBar } from "@/components/dashboard/DashboardSearchBar";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { DashboardQuickFilters } from "@/components/dashboard/DashboardQuickFilters";
import { DashboardControls } from "@/components/dashboard/DashboardControls";
import { ViewModeToggle } from "@/components/dashboard/ViewModeToggle";
import { DashboardPagination } from "@/components/dashboard/DashboardPagination";
import { DashboardStatsBar } from "@/components/dashboard/DashboardStatsBar";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { EmptyState as GenericEmptyState, InspectionsEmptyState, TrainingsEmptyState, DailyAssessmentsEmptyState } from "@/components/EmptyState";
import { triggerHaptic } from "@/lib/haptics";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getAssigneeName } from "@/lib/report-utils";

/**
 * Normalize a string for fuzzy matching: lowercase, remove diacritics,
 * collapse whitespace.
 */
function normalizeForSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function textMatchesReport(report: any, query: string, type: string): boolean {
  const q = normalizeForSearch(query);
  if (!q) return false;
  const org = normalizeForSearch(report.organization || '');
  const loc = normalizeForSearch(report.location || report.site || '');
  const assignee = normalizeForSearch(getAssigneeName(report, type));

  // Exact substring match first (fast path)
  if (org.includes(q) || loc.includes(q) || assignee.includes(q)) return true;

  // Token-by-token matching: every query token must appear in at least one field
  const tokens = q.split(' ').filter(Boolean);
  if (tokens.length > 1) {
    const combined = `${org} ${loc} ${assignee}`;
    return tokens.every(token => combined.includes(token));
  }

  // Single-token fuzzy: check if query is a substring allowing 1-char difference
  // e.g. "ariel" matches "airiel" because "ariel" is a subsequence
  if (q.length >= 3) {
    const fields = [org, loc, assignee];
    for (const field of fields) {
      if (isCloseSubstring(field, q)) return true;
    }
  }

  return false;
}

/**
 * Check if `needle` is approximately contained in `haystack`
 * allowing at most 1 extra/missing/different character.
 */
function isCloseSubstring(haystack: string, needle: string): boolean {
  if (haystack.includes(needle)) return true;
  // Check if needle is a subsequence of any substring of similar length
  const len = needle.length;
  for (let i = 0; i <= haystack.length - len + 1; i++) {
    const slice = haystack.substring(i, i + len + 1);
    if (editDistance1(slice, needle)) return true;
  }
  return false;
}

function editDistance1(a: string, b: string): boolean {
  const diff = Math.abs(a.length - b.length);
  if (diff > 1) return false;
  let mismatches = 0;
  let ai = 0, bi = 0;
  while (ai < a.length && bi < b.length) {
    if (a[ai] !== b[bi]) {
      mismatches++;
      if (mismatches > 1) return false;
      if (a.length > b.length) ai++;
      else if (b.length > a.length) bi++;
      else { ai++; bi++; }
    } else {
      ai++; bi++;
    }
  }
  return true;
}

type DashboardReportType = 'inspection' | 'training' | 'daily';

function normalizeInvoicedReport(report: any, type: DashboardReportType) {
  return {
    ...report,
    __reportType: type,
    inspection_date:
      type === 'inspection'
        ? report.inspection_date || report.created_at || ''
        : type === 'training'
          ? report.training?.start_date || report.start_date || report.created_at || ''
          : report.assessment_date || report.created_at || '',
    location: report.location || report.site || '',
    inspector: type === 'training' ? (report.trainer || report.inspector) : report.inspector,
  };
}

function resolveDashboardReportType(report: any, fallback: DashboardReportType): DashboardReportType {
  const reportType = report?.__reportType;
  return reportType === 'inspection' || reportType === 'training' || reportType === 'daily'
    ? reportType
    : fallback;
}

interface DashboardReportsSectionProps {
  inspections: any[];
  trainings: any[];
  dailyAssessments: any[];
  allInspections?: any[];
  allTrainings?: any[];
  allDailyAssessments?: any[];
  totalInspections?: number;
  totalTrainings?: number;
  totalDailyAssessments?: number;
  dataValidated?: boolean;
  inspectionsValidated?: boolean;
  trainingsValidated?: boolean;
  dailyValidated?: boolean;
  activeReportTab: string;
  setActiveReportTab: (tab: string) => void;
  loading: boolean;
  currentUserId: string | null;
  uniqueInspectors: { id: string; name: string }[];
  isSuperAdmin: boolean;
  inspectorFilter: string;
  setInspectorFilter: (v: string) => void;
  navigate: (path: string) => void;
  getStatusBadge: (report: any) => React.ReactNode;
  setInspectionToDelete: (report: any) => void;
  setReportToDelete: (report: any) => void;
  setDeleteDialogOpen: (open: boolean) => void;
  invoicedReportIds?: Set<string>;
  invoicedMetaById?: ReadonlyMap<string, { invoiced_at: string; invoiced_by: string | null }>;
  onToggleInvoiced?: (report: any, type: DashboardReportType) => void;
  invoicedCount?: number;
  profilesById?: ReadonlyMap<string, { first_name: string | null; last_name: string | null; avatar_url: string | null }>;
}

export function DashboardReportsSection({
  inspections,
  trainings,
  dailyAssessments,
  allInspections,
  allTrainings,
  allDailyAssessments,
  totalInspections,
  totalTrainings,
  totalDailyAssessments,
  dataValidated,
  inspectionsValidated,
  trainingsValidated,
  dailyValidated,
  activeReportTab,
  setActiveReportTab,
  loading,
  currentUserId,
  uniqueInspectors,
  isSuperAdmin,
  inspectorFilter,
  setInspectorFilter,
  navigate,
  getStatusBadge,
  setInspectionToDelete,
  setReportToDelete,
  setDeleteDialogOpen,
  invoicedReportIds,
  invoicedMetaById,
  onToggleInvoiced,
  invoicedCount,
  profilesById,
}: DashboardReportsSectionProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [compact, setCompact] = useState(false);
  const [statsFilter, setStatsFilter] = useState<string | null>(null);
  const prevTabRef = useRef(activeReportTab);

  // Build invoiced reports list for the Invoiced tab (admin only)
  const invoicedReports = useMemo(() => {
    if (!isSuperAdmin || !invoicedReportIds || invoicedReportIds.size === 0) return [];
    const all: { report: any; type: DashboardReportType }[] = [];
    for (const r of inspections) {
      if (invoicedReportIds.has(r.id)) all.push({ report: normalizeInvoicedReport(r, 'inspection'), type: 'inspection' });
    }
    for (const r of trainings) {
      if (invoicedReportIds.has(r.id)) all.push({ report: normalizeInvoicedReport(r, 'training'), type: 'training' });
    }
    for (const r of dailyAssessments) {
      if (invoicedReportIds.has(r.id)) all.push({ report: normalizeInvoicedReport(r, 'daily'), type: 'daily' });
    }
    return all;
  }, [isSuperAdmin, invoicedReportIds, inspections, trainings, dailyAssessments]);

  const currentReports = activeReportTab === 'inspections' ? inspections
    : activeReportTab === 'training' ? trainings
    : activeReportTab === 'invoiced' ? invoicedReports.map(r => r.report)
    : dailyAssessments;

  const currentType = (activeReportTab === 'inspections' ? 'inspection'
    : activeReportTab === 'training' ? 'training'
    : activeReportTab === 'invoiced' ? 'inspection'
    : 'daily') as DashboardReportType;

  const statuses = useMemo(() => [...new Set(currentReports.map(r => r.status).filter(Boolean))], [currentReports]);

  const uniqueFacilities = useMemo(() => {
    const locations = currentReports
      .map(r => r.location || r.site || '')
      .filter(Boolean);
    return [...new Set(locations)].sort((a, b) => a.localeCompare(b));
  }, [currentReports]);

  // Scope uniqueInspectors to the current tab's data (Issue 4)
  const scopedInspectors = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of currentReports) {
      const person = currentType === 'training' ? r.trainer : r.inspector;
      if (person?.first_name || person?.last_name) {
        map.set(r.inspector_id, `${person.first_name || ''} ${person.last_name || ''}`.trim());
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [currentReports, currentType]);

  const {
    filters,
    updateFilter,
    toggleQuickFilter,
    clearAllFilters,
    completedCollapsed,
    setCompletedCollapsed,
    toggleGroupCollapse,
    collapsedGroups,
    hasActiveFilters,
    groups,
    totalPages,
    currentPage,
    filteredCount,
    criticalCount,
    warningCount,
  } = useDashboardFilters(currentReports, currentType, currentUserId, isSuperAdmin, profilesById);

  // Compute stats from full datasets (not sliced "Recent" arrays)
  const statsData = useMemo(() => {
    const fullData = activeReportTab === 'inspections' ? (allInspections ?? inspections)
      : activeReportTab === 'training' ? (allTrainings ?? trainings)
      // Fix 3: invoiced tab pulls from the full invoiced source, not the
      // already-filtered/sliced currentReports. Otherwise the TOTAL card
      // can disagree with the "Invoiced (N)" tab label, especially while
      // invoicedReports is still loading asynchronously.
      : activeReportTab === 'invoiced' ? invoicedReports.map(r => r.report)
      : (allDailyAssessments ?? dailyAssessments);
    const total = fullData.length;
    const drafts = fullData.filter(r => r.status === 'draft').length;
    const completed = fullData.filter(r => r.status === 'completed').length;
    // Compute overdue from full data, not from the sliced filter hook
    const now = new Date();
    const overdue = fullData.filter(r => {
      if (r.status === 'completed') return false;
      const createdAt = r.created_at ? new Date(r.created_at) : null;
      if (!createdAt || isNaN(createdAt.getTime())) return true; // treat missing date as overdue
      const age = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
      return age > 3; // matches tierOf: >3 days = warning, >5 = critical
    }).length;
    return { total, drafts, overdue, completed };
  }, [activeReportTab, allInspections, allTrainings, allDailyAssessments, inspections, trainings, dailyAssessments, invoicedReports]);

  // Handle stats bar filter clicks
  const handleStatsFilter = (filter: 'all' | 'drafts' | 'overdue' | 'completed') => {
    if (statsFilter === filter) {
      // Toggle off
      setStatsFilter(null);
      updateFilter('statusFilter', 'all');
      if (filters.quickFilters.draftsOnly) toggleQuickFilter('draftsOnly');
      if (filters.quickFilters.needsAttention) toggleQuickFilter('needsAttention');
    } else {
      setStatsFilter(filter);
      // Reset conflicting filters first
      if (filters.quickFilters.draftsOnly) toggleQuickFilter('draftsOnly');
      if (filters.quickFilters.needsAttention) toggleQuickFilter('needsAttention');
      updateFilter('statusFilter', 'all');

      if (filter === 'drafts') toggleQuickFilter('draftsOnly');
      else if (filter === 'overdue') toggleQuickFilter('needsAttention');
      else if (filter === 'completed') updateFilter('statusFilter', 'completed');
      // 'all' clears everything
    }
  };

  // Cross-tab search: when search is active, filter all report types
  const isSearchActive = filters.search.trim().length > 0;

  const crossTabResults = useMemo(() => {
    if (!isSearchActive) return null;
    const q = filters.search.trim();
    // Use full (unsliced) arrays for search so results aren't limited by "Recent" view
    const searchInspections = allInspections ?? inspections;
    const searchTrainings = allTrainings ?? trainings;
    const searchDaily = allDailyAssessments ?? dailyAssessments;
    const filteredInspections = searchInspections.filter(r => textMatchesReport(r, q, 'inspection'));
    const filteredTrainings = searchTrainings.filter(r => textMatchesReport(r, q, 'training'));
    const filteredDaily = searchDaily.filter(r => textMatchesReport(r, q, 'daily'));
    return {
      inspections: filteredInspections,
      trainings: filteredTrainings,
      daily: filteredDaily,
      total: filteredInspections.length + filteredTrainings.length + filteredDaily.length,
    };
  }, [isSearchActive, filters.search, inspections, trainings, dailyAssessments, allInspections, allTrainings, allDailyAssessments]);

  // Reset filters when switching tabs to avoid stale filter state (Issue 1)
  useEffect(() => {
    if (prevTabRef.current !== activeReportTab) {
      prevTabRef.current = activeReportTab;
      clearAllFilters();
      setStatsFilter(null);
    }
  }, [activeReportTab, clearAllFilters]);

  // Auto-clear conflicting filters when "Completed" sort is selected (Issue 2)
  useEffect(() => {
    if (filters.sortBy === 'completed') {
      if (filters.quickFilters.draftsOnly) {
        toggleQuickFilter('draftsOnly');
      }
      if (filters.statusFilter !== 'all' && filters.statusFilter !== 'completed') {
        updateFilter('statusFilter', 'all');
      }
    }
  }, [filters.sortBy]);

  const handleDelete = (report: any) => {
    const reportType = resolveDashboardReportType(report, currentType);
    if (reportType === 'inspection') {
      setInspectionToDelete(report);
    } else {
      setReportToDelete(report);
    }
    setDeleteDialogOpen(true);
  };

  const handleClick = (report: any, type?: DashboardReportType) => {
    const resolvedType = type || resolveDashboardReportType(report, currentType);
    if (resolvedType === 'inspection') navigate(`/inspection/${report.id}`);
    else if (resolvedType === 'training') navigate(`/training/${report.id}`);
    else navigate(`/daily-assessment/${report.id}`);
  };

  const handleDeleteForType = (report: any, type: DashboardReportType) => {
    if (type === 'inspection') {
      setInspectionToDelete(report);
    } else {
      setReportToDelete(report);
    }
    setDeleteDialogOpen(true);
  };

  const InvoicedEmptyState = ({ onAction }: { onAction: () => void }) => (
    <GenericEmptyState
      icon={Receipt}
      title="No invoiced reports"
      description="Reports you mark as invoiced will appear here."
    />
  );

  const EmptyState = activeReportTab === 'inspections' ? InspectionsEmptyState
    : activeReportTab === 'training' ? TrainingsEmptyState
    : activeReportTab === 'daily' ? DailyAssessmentsEmptyState
    : InvoicedEmptyState;

  const newPath = activeReportTab === 'inspections' ? '/inspection/new'
    : activeReportTab === 'training' ? '/training/new'
    : '/daily-assessment/new';

  return (
    <div>
      {/* Sticky filter bar */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm pb-4 space-y-3 -mx-4 px-4 pt-2 border-b border-border/50 mb-4">
        <DashboardSearchBar
          value={filters.search}
          onChange={(v) => updateFilter('search', v)}
        />

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="w-3.5 h-3.5" />
              Filters
              {hasActiveFilters && (
                <span className="ml-1 w-2 h-2 rounded-full bg-primary" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setCompact(!compact)}
              title={compact ? 'Normal density' : 'Compact density'}
            >
              {compact ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
            </Button>
          </div>

          <DashboardControls
            sortBy={filters.sortBy}
            onSortChange={(v) => updateFilter('sortBy', v)}
            groupBy={filters.groupBy}
            onGroupChange={(v) => updateFilter('groupBy', v)}
          />
        </div>

        {showFilters && (
          <div className="space-y-3 pt-1">
            <DashboardFilters
              statusFilter={filters.statusFilter}
              onStatusChange={(v) => updateFilter('statusFilter', v)}
              assigneeFilter={filters.assigneeFilter}
              onAssigneeChange={(v) => updateFilter('assigneeFilter', v)}
              dateRange={filters.dateRange}
              onDateRangeChange={(v) => updateFilter('dateRange', v)}
              syncFilter={filters.syncFilter}
              onSyncChange={(v) => updateFilter('syncFilter', v)}
              uniqueInspectors={scopedInspectors}
              statuses={statuses}
              alphabeticalFilter={filters.alphabeticalFilter}
              onAlphabeticalChange={(v) => updateFilter('alphabeticalFilter', v)}
              facilityFilter={filters.facilityFilter}
              onFacilityChange={(v) => updateFilter('facilityFilter', v)}
              uniqueFacilities={uniqueFacilities}
            />

            <DashboardQuickFilters
              quickFilters={filters.quickFilters}
              onToggle={toggleQuickFilter}
              criticalCount={criticalCount}
              warningCount={warningCount}
            />
          </div>
        )}

        {hasActiveFilters && !isSearchActive && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{filteredCount} results</span>
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={clearAllFilters}>
              <X className="w-3 h-3" />
              Clear filters
            </Button>
          </div>
        )}
      </div>

      {/* Stats bar */}
      {!loading && !isSearchActive && (
        <DashboardStatsBar
          total={statsData.total}
          drafts={statsData.drafts}
          overdue={statsData.overdue}
          completed={statsData.completed}
          onFilterClick={handleStatsFilter}
          activeFilter={statsFilter}
          dataValidated={
            activeReportTab === 'inspections' ? inspectionsValidated
            : activeReportTab === 'training' ? trainingsValidated
            : activeReportTab === 'daily' ? dailyValidated
            : (inspectionsValidated && trainingsValidated && dailyValidated)
          }
        />
      )}

      {/* Cross-tab search results */}
      {isSearchActive && !loading ? (
        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Searching all reports — {crossTabResults?.total ?? 0} results
            </span>
          </div>

          {crossTabResults && crossTabResults.total === 0 && (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-muted-foreground mb-4">No reports match your search across all types</p>
                <Button variant="outline" onClick={() => { updateFilter('search', ''); }}>Clear search</Button>
              </CardContent>
            </Card>
          )}

          {crossTabResults && crossTabResults.inspections.length > 0 && (
            <CrossTabSection
              label="Inspections"
              icon={<FileText className="w-4 h-4" />}
              reports={crossTabResults.inspections}
              type="inspection"
              compact={compact}
              viewMode={filters.viewMode}
              onDelete={(r) => handleDeleteForType(r, 'inspection')}
              onClick={(r) => handleClick(r, 'inspection')}
              getStatusBadge={getStatusBadge}
              profilesById={profilesById}
            />
          )}

          {crossTabResults && crossTabResults.trainings.length > 0 && (
            <CrossTabSection
              label="Training"
              icon={<GraduationCap className="w-4 h-4" />}
              reports={crossTabResults.trainings}
              type="training"
              compact={compact}
              viewMode={filters.viewMode}
              onDelete={(r) => handleDeleteForType(r, 'training')}
              onClick={(r) => handleClick(r, 'training')}
              profilesById={profilesById}
            />
          )}

          {crossTabResults && crossTabResults.daily.length > 0 && (
            <CrossTabSection
              label="Daily Assessments"
              icon={<FileText className="w-4 h-4" />}
              reports={crossTabResults.daily}
              type="daily"
              compact={compact}
              viewMode={filters.viewMode}
              onDelete={(r) => handleDeleteForType(r, 'daily')}
              onClick={(r) => handleClick(r, 'daily')}
              profilesById={profilesById}
            />
          )}
        </div>
      ) : (
        /* Normal tab-based view */
        <Tabs value={activeReportTab} onValueChange={setActiveReportTab}>
          <TabsList className="grid grid-cols-2 sm:inline-flex w-full sm:w-auto mb-4 h-auto">
            <TabsTrigger value="inspections" className="flex items-center gap-2">
              <FileText className="w-4 h-4 hidden sm:inline" />
              Inspections ({totalInspections !== undefined ? totalInspections : '…'})
            </TabsTrigger>
            <TabsTrigger value="training" className="flex items-center gap-2">
              <GraduationCap className="w-4 h-4 hidden sm:inline" />
              Training ({totalTrainings !== undefined ? totalTrainings : '…'})
            </TabsTrigger>
            <TabsTrigger value="daily" className="flex items-center gap-2">
              <FileText className="w-4 h-4 hidden sm:inline" />
              Daily ({totalDailyAssessments !== undefined ? totalDailyAssessments : '…'})
            </TabsTrigger>
            {isSuperAdmin && (
              <TabsTrigger value="invoiced" className="flex items-center gap-2">
                <Receipt className="w-4 h-4 hidden sm:inline" />
                Invoiced ({invoicedCount ?? invoicedReports.length})
              </TabsTrigger>
            )}
          </TabsList>

          {/* Content for all tabs - rendered by the same logic */}
          {['inspections', 'training', 'daily', ...(isSuperAdmin ? ['invoiced'] : [])].map((tab) => (
            <TabsContent key={tab} value={tab}>
              {loading ? (
                <div className="grid gap-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <ReportCardSkeleton key={i} />
                  ))}
                </div>
              ) : filteredCount === 0 ? (
                hasActiveFilters ? (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <p className="text-muted-foreground mb-4">No reports match your filters</p>
                      <Button variant="outline" onClick={() => { clearAllFilters(); setStatsFilter(null); }}>Clear all filters</Button>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="p-0">
                      <EmptyState
                        onAction={() => {
                          triggerHaptic('light');
                          navigate(newPath);
                        }}
                      />
                    </CardContent>
                  </Card>
                )
              ) : (
                <div className={cn("space-y-6", compact && "space-y-3")}>
                  {groups.map((rawGroup, gi) => {
                    const isCompleted = rawGroup.label.startsWith('Completed');
                    // In Completed group, push non-invoiced reports to the top so
                    // outstanding billing work is immediately visible. Stable partition
                    // preserves the existing within-subgroup order.
                    const sortedItems = (isCompleted && invoicedReportIds)
                      ? [
                          ...rawGroup.items.filter((r: any) => !invoicedReportIds.has(r.id)),
                          ...rawGroup.items.filter((r: any) => invoicedReportIds.has(r.id)),
                        ]
                      : rawGroup.items;
                    const group = sortedItems === rawGroup.items ? rawGroup : { ...rawGroup, items: sortedItems };
                    const isCollapsed = isCompleted ? completedCollapsed : collapsedGroups.has(group.label);
                    const showHeader = groups.length > 1 || filters.groupBy !== 'none';

                    const getCollapsedSummary = () => {
                      if (!isCollapsed || group.items.length === 0) return null;
                      const last = group.items[0];
                      const org = last?.organization || 'Unknown';
                      return `${group.count} reports — latest: ${org}`;
                    };

                    const gridClass = cn(
                      "grid md:grid-cols-2 lg:grid-cols-3",
                      compact ? "gap-2" : "gap-4"
                    );

                    return (
                      <div key={group.label}>
                        {showHeader && (
                          <Collapsible
                            open={!isCollapsed}
                            onOpenChange={() => isCompleted ? setCompletedCollapsed(!completedCollapsed) : toggleGroupCollapse(group.label)}
                          >
                            <div className="flex items-center gap-2 mb-3">
                              <CollapsibleTrigger asChild>
                                <button className="flex items-center gap-2 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity">
                                  {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                  <span className="font-semibold text-sm">{group.label}</span>
                                  <Badge variant="secondary" className="text-xs">{group.count}</Badge>
                                  {isCollapsed && getCollapsedSummary() && (
                                    <span className="text-xs text-muted-foreground ml-2 truncate">{getCollapsedSummary()}</span>
                                  )}
                                </button>
                              </CollapsibleTrigger>
                              <ViewModeToggle
                                viewMode={filters.viewMode}
                                onViewModeChange={(v) => updateFilter('viewMode', v)}
                                className="ml-auto flex-shrink-0"
                              />
                            </div>
                            <CollapsibleContent>
                              {filters.viewMode === 'list' || filters.viewMode === 'split' ? (
                                <ReportListView
                                  reports={group.items}
                                  type={currentType}
                                  onRowClick={handleClick}
                                  onDelete={handleDelete}
                                  compact={compact}
                                  twoColumn={filters.viewMode === 'split'}
                                  isAdmin={isSuperAdmin}
                                  invoicedReportIds={invoicedReportIds}
                                  invoicedMetaById={invoicedMetaById}
                                  onToggleInvoiced={onToggleInvoiced}
                                  profilesById={profilesById}
                                  getStatusBadge={currentType === 'inspection' ? getStatusBadge : undefined}
                                />
                              ) : (
                                <div className={gridClass}>
                                  {group.items.map((report: any) => {
                                    const effectiveType = activeReportTab === 'invoiced'
                                      ? (invoicedReports.find(ir => ir.report.id === report.id)?.type || currentType)
                                      : currentType;
                                    return (
                                      <ReportCard
                                        key={report.id}
                                        report={report}
                                        type={effectiveType}
                                        onDelete={handleDelete}
                                        onClick={(r) => handleClick(r, effectiveType)}
                                        getStatusBadge={effectiveType === 'inspection' ? getStatusBadge : undefined}
                                        compact={compact}
                                        isAdmin={isSuperAdmin}
                                        isInvoiced={invoicedReportIds?.has(report.id)}
                                        invoicedMeta={invoicedMetaById?.get(report.id)}
                                        onToggleInvoiced={onToggleInvoiced}
                                        profilesById={profilesById}
                                      />
                                    );
                                  })}
                                </div>
                              )}
                            </CollapsibleContent>
                          </Collapsible>
                        )}
                        {!showHeader && (
                          <>
                            {gi === 0 && (
                              <div className="flex justify-end mb-3">
                                <ViewModeToggle
                                  viewMode={filters.viewMode}
                                  onViewModeChange={(v) => updateFilter('viewMode', v)}
                                />
                              </div>
                            )}
                            {filters.viewMode === 'list' || filters.viewMode === 'split' ? (
                            <ReportListView
                              reports={group.items}
                              type={currentType}
                              onRowClick={handleClick}
                              onDelete={handleDelete}
                              compact={compact}
                              twoColumn={filters.viewMode === 'split'}
                              isAdmin={isSuperAdmin}
                              invoicedReportIds={invoicedReportIds}
                              invoicedMetaById={invoicedMetaById}
                              onToggleInvoiced={onToggleInvoiced}
                              profilesById={profilesById}
                              getStatusBadge={currentType === 'inspection' ? getStatusBadge : undefined}
                            />
                          ) : (
                            <div className={gridClass}>
                              {group.items.map((report: any) => {
                                const effectiveType = activeReportTab === 'invoiced'
                                  ? (invoicedReports.find(ir => ir.report.id === report.id)?.type || currentType)
                                  : currentType;
                                return (
                                  <ReportCard
                                    key={report.id}
                                    report={report}
                                    type={effectiveType}
                                    onDelete={handleDelete}
                                    onClick={(r) => handleClick(r, effectiveType)}
                                    getStatusBadge={effectiveType === 'inspection' ? getStatusBadge : undefined}
                                    compact={compact}
                                    isAdmin={isSuperAdmin}
                                    isInvoiced={invoicedReportIds?.has(report.id)}
                                    invoicedMeta={invoicedMetaById?.get(report.id)}
                                    onToggleInvoiced={onToggleInvoiced}
                                    profilesById={profilesById}
                                  />
                                );
                              })}
                            </div>
                          )}
                          </>
                        )}
                      </div>
                    );
                  })}

                  <DashboardPagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={(p) => updateFilter('page', p)}
                  />
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

/* ── Cross-tab search result section ── */

interface CrossTabSectionProps {
  label: string;
  icon: React.ReactNode;
  reports: any[];
  type: 'inspection' | 'training' | 'daily';
  compact: boolean;
  viewMode: 'grid' | 'list' | 'split';
  onDelete: (report: any) => void;
  onClick: (report: any) => void;
  getStatusBadge?: (report: any) => React.ReactNode;
  profilesById?: ReadonlyMap<string, { first_name: string | null; last_name: string | null; avatar_url: string | null }>;
}

function CrossTabSection({ label, icon, reports, type, compact, viewMode, onDelete, onClick, getStatusBadge, profilesById }: CrossTabSectionProps) {
  const gridClass = cn(
    "grid md:grid-cols-2 lg:grid-cols-3",
    compact ? "gap-2" : "gap-4"
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="font-semibold text-sm">{label}</span>
        <Badge variant="secondary" className="text-xs">{reports.length}</Badge>
      </div>
      {viewMode === 'list' || viewMode === 'split' ? (
        <ReportListView
          reports={reports}
          type={type}
          onRowClick={onClick}
          onDelete={onDelete}
          compact={compact}
          twoColumn={viewMode === 'split'}
          profilesById={profilesById}
          getStatusBadge={type === 'inspection' ? getStatusBadge : undefined}
        />
      ) : (
        <div className={gridClass}>
          {reports.map((report: any) => (
            <ReportCard
              key={report.id}
              report={report}
              type={type}
              onDelete={onDelete}
              onClick={onClick}
              getStatusBadge={type === 'inspection' ? getStatusBadge : undefined}
              compact={compact}
              profilesById={profilesById}
            />
          ))}
        </div>
      )}
    </div>
  );
}
