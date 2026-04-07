import { useMemo, useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FileText, GraduationCap, ChevronDown, ChevronRight, X, Filter, Minimize2, Maximize2, Search } from "lucide-react";
import { ReportCard } from "@/components/dashboard/ReportCard";
import { ReportCardSkeleton } from "@/components/dashboard/ReportCardSkeleton";
import { ReportListView } from "@/components/dashboard/ReportListView";
import { DashboardSearchBar } from "@/components/dashboard/DashboardSearchBar";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { DashboardQuickFilters } from "@/components/dashboard/DashboardQuickFilters";
import { DashboardControls } from "@/components/dashboard/DashboardControls";
import { DashboardPagination } from "@/components/dashboard/DashboardPagination";
import { DashboardStatsBar } from "@/components/dashboard/DashboardStatsBar";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { InspectionsEmptyState, TrainingsEmptyState, DailyAssessmentsEmptyState } from "@/components/EmptyState";
import { triggerHaptic } from "@/lib/haptics";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getAssigneeName } from "@/lib/report-utils";

function textMatchesReport(report: any, query: string, type: string): boolean {
  const q = query.toLowerCase();
  const org = (report.organization || '').toLowerCase();
  const loc = (report.location || report.site || '').toLowerCase();
  const assignee = getAssigneeName(report, type).toLowerCase();
  return org.includes(q) || loc.includes(q) || assignee.includes(q);
}

interface DashboardReportsSectionProps {
  inspections: any[];
  trainings: any[];
  dailyAssessments: any[];
  totalInspections?: number;
  totalTrainings?: number;
  totalDailyAssessments?: number;
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
}

export function DashboardReportsSection({
  inspections,
  trainings,
  dailyAssessments,
  totalInspections,
  totalTrainings,
  totalDailyAssessments,
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
}: DashboardReportsSectionProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [compact, setCompact] = useState(false);
  const [statsFilter, setStatsFilter] = useState<string | null>(null);
  const prevTabRef = useRef(activeReportTab);

  const currentReports = activeReportTab === 'inspections' ? inspections
    : activeReportTab === 'training' ? trainings
    : dailyAssessments;

  const currentType = (activeReportTab === 'inspections' ? 'inspection'
    : activeReportTab === 'training' ? 'training'
    : 'daily') as 'inspection' | 'training' | 'daily';

  const statuses = useMemo(() => [...new Set(currentReports.map(r => r.status).filter(Boolean))], [currentReports]);

  const uniqueFacilities = useMemo(() => {
    const locations = currentReports
      .map(r => r.location || '')
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
  } = useDashboardFilters(currentReports, currentType, currentUserId, isSuperAdmin);

  // Compute stats for the stats bar
  const statsData = useMemo(() => {
    const total = currentReports.length;
    const drafts = currentReports.filter(r => r.status === 'draft').length;
    const completed = currentReports.filter(r => r.status === 'completed').length;
    const overdue = criticalCount + warningCount;
    return { total, drafts, overdue, completed };
  }, [currentReports, criticalCount, warningCount]);

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
    if (currentType === 'inspection') {
      setInspectionToDelete(report);
    } else {
      setReportToDelete(report);
    }
    setDeleteDialogOpen(true);
  };

  const handleClick = (report: any) => {
    if (currentType === 'inspection') navigate(`/inspection/${report.id}`);
    else if (currentType === 'training') navigate(`/training/${report.id}`);
    else navigate(`/daily-assessment/${report.id}`);
  };

  const EmptyState = activeReportTab === 'inspections' ? InspectionsEmptyState
    : activeReportTab === 'training' ? TrainingsEmptyState
    : DailyAssessmentsEmptyState;

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
            viewMode={filters.viewMode}
            onViewModeChange={(v) => updateFilter('viewMode', v)}
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

        {hasActiveFilters && (
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
      {!loading && (
        <DashboardStatsBar
          total={statsData.total}
          drafts={statsData.drafts}
          overdue={statsData.overdue}
          completed={statsData.completed}
          onFilterClick={handleStatsFilter}
          activeFilter={statsFilter}
        />
      )}

      {/* Report type tabs */}
      <Tabs value={activeReportTab} onValueChange={setActiveReportTab}>
        <TabsList className="w-full sm:w-auto mb-4">
          <TabsTrigger value="inspections" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Inspections ({loading || (!totalInspections && inspections.length === 0) ? '…' : (totalInspections ?? inspections.length)})
          </TabsTrigger>
          <TabsTrigger value="training" className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4" />
            Training ({loading || (!totalTrainings && trainings.length === 0) ? '…' : (totalTrainings ?? trainings.length)})
          </TabsTrigger>
          <TabsTrigger value="daily" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Daily ({loading || (!totalDailyAssessments && dailyAssessments.length === 0) ? '…' : (totalDailyAssessments ?? dailyAssessments.length)})
          </TabsTrigger>
        </TabsList>

        {/* Content for all tabs - rendered by the same logic */}
        {['inspections', 'training', 'daily'].map((tab) => (
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
                {groups.map((group, gi) => {
                  const isCompleted = group.label.startsWith('Completed');
                  const isCollapsed = isCompleted ? completedCollapsed : collapsedGroups.has(group.label);
                  const showHeader = groups.length > 1 || filters.groupBy !== 'none';

                  // Get summary for collapsed groups
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
                          <CollapsibleTrigger className="flex items-center gap-2 mb-3 w-full text-left hover:opacity-80 transition-opacity">
                            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            <span className="font-semibold text-sm">{group.label}</span>
                            <Badge variant="secondary" className="text-xs">{group.count}</Badge>
                            {isCollapsed && getCollapsedSummary() && (
                              <span className="text-xs text-muted-foreground ml-2 truncate">{getCollapsedSummary()}</span>
                            )}
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            {filters.viewMode === 'list' ? (
                              <ReportListView
                                reports={group.items}
                                type={currentType}
                                onRowClick={handleClick}
                              />
                            ) : (
                              <div className={gridClass}>
                                {group.items.map((report: any) => (
                                  <ReportCard
                                    key={report.id}
                                    report={report}
                                    type={currentType}
                                    onDelete={handleDelete}
                                    onClick={handleClick}
                                    getStatusBadge={currentType === 'inspection' ? getStatusBadge : undefined}
                                    compact={compact}
                                  />
                                ))}
                              </div>
                            )}
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                      {!showHeader && (
                        filters.viewMode === 'list' ? (
                          <ReportListView
                            reports={group.items}
                            type={currentType}
                            onRowClick={handleClick}
                          />
                        ) : (
                          <div className={gridClass}>
                            {group.items.map((report: any) => (
                              <ReportCard
                                key={report.id}
                                report={report}
                                type={currentType}
                                onDelete={handleDelete}
                                onClick={handleClick}
                                getStatusBadge={currentType === 'inspection' ? getStatusBadge : undefined}
                                compact={compact}
                              />
                            ))}
                          </div>
                        )
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
    </div>
  );
}
