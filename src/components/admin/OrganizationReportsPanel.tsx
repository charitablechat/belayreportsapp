import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronDown, FileText, GraduationCap, ClipboardCheck, Search, ArrowUpDown } from "lucide-react";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";

interface OrganizationReportsPanelProps {
  organizationId: string;
  organizationName: string;
}

export function OrganizationReportsPanel({ organizationId, organizationName }: OrganizationReportsPanelProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<Record<string, "asc" | "desc">>({
    inspections: "desc",
    trainings: "desc",
    dailyAssessments: "desc",
  });
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    inspections: true,
    trainings: true,
    dailyAssessments: true,
  });

  const { data: inspections, isLoading: loadingInspections } = useQuery({
    queryKey: ["org-inspections", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inspections")
        .select("id, organization, location, inspection_date, status, inspector:profiles!inspections_inspector_id_profiles_fkey(first_name, last_name)")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("inspection_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: trainings, isLoading: loadingTrainings } = useQuery({
    queryKey: ["org-trainings", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trainings")
        .select("id, organization, location, start_date, status, trainer:profiles!trainings_inspector_id_profiles_fkey(first_name, last_name)")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: dailyAssessments, isLoading: loadingDaily } = useQuery({
    queryKey: ["org-daily-assessments", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_assessments")
        .select("id, organization, site, assessment_date, status, inspector:profiles!daily_assessments_inspector_id_profiles_fkey(first_name, last_name)")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("assessment_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const toggleSection = (key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleSort = (key: string) => {
    setSortOrder(prev => ({ ...prev, [key]: prev[key] === "desc" ? "asc" : "desc" }));
  };

  const getPersonName = (person: any) => {
    if (!person) return "—";
    return `${person.first_name || ""} ${person.last_name || ""}`.trim() || "—";
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      const parsed = parseLocalDate(dateStr);
      return parsed ? format(parsed, "MMM d, yyyy") : "—";
    } catch {
      return "—";
    }
  };

  const matchesSearch = (row: any, dateField: string) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (row.organization || "").toLowerCase().includes(q) ||
      (row.location || row.site || "").toLowerCase().includes(q) ||
      (row.status || "").toLowerCase().includes(q) ||
      getPersonName(row.inspector || row.trainer).toLowerCase().includes(q) ||
      formatDate(row[dateField]).toLowerCase().includes(q)
    );
  };

  const sortByDate = <T extends Record<string, any>>(items: T[], dateField: string, order: "asc" | "desc"): T[] => {
    return [...items].sort((a, b) => {
      const da = a[dateField] || "";
      const db = b[dateField] || "";
      return order === "asc" ? da.localeCompare(db) : db.localeCompare(da);
    });
  };

  const filteredInspections = useMemo(() => {
    if (!inspections) return [];
    const filtered = inspections.filter(r => matchesSearch(r, "inspection_date"));
    return sortByDate(filtered, "inspection_date", sortOrder.inspections);
  }, [inspections, searchQuery, sortOrder.inspections]);

  const filteredTrainings = useMemo(() => {
    if (!trainings) return [];
    const filtered = trainings.filter(r => matchesSearch(r, "start_date"));
    return sortByDate(filtered, "start_date", sortOrder.trainings);
  }, [trainings, searchQuery, sortOrder.trainings]);

  const filteredDaily = useMemo(() => {
    if (!dailyAssessments) return [];
    const filtered = dailyAssessments.filter(r => matchesSearch(r, "assessment_date"));
    return sortByDate(filtered, "assessment_date", sortOrder.dailyAssessments);
  }, [dailyAssessments, searchQuery, sortOrder.dailyAssessments]);

  const renderLoadingSkeleton = () => (
    <div className="space-y-2 p-4">
      {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );

  const renderEmptyState = (label: string) => (
    <div className="py-8 text-center text-sm text-muted-foreground">
      No {label} found{searchQuery ? " matching your search" : " for this organization"}
    </div>
  );

  const SortButton = ({ sectionKey }: { sectionKey: string }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-xs"
      onClick={(e) => { e.stopPropagation(); toggleSort(sectionKey); }}
    >
      <ArrowUpDown className="h-3 w-3 mr-1" />
      {sortOrder[sectionKey] === "desc" ? "Newest" : "Oldest"}
    </Button>
  );

  return (
    <div className="space-y-4 pt-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search reports by name, location, status…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Inspections */}
      <Collapsible open={openSections.inspections} onOpenChange={() => toggleSection("inspections")}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full rounded-md border bg-muted/40 px-4 py-3 text-sm font-medium hover:bg-muted/60 transition-colors">
          <FileText className="h-4 w-4 text-primary" />
          <span>Inspections ({loadingInspections ? "…" : filteredInspections.length})</span>
          <SortButton sectionKey="inspections" />
          <ChevronDown className={cn("h-4 w-4 ml-auto transition-transform", openSections.inspections && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {loadingInspections ? renderLoadingSkeleton() : !filteredInspections.length ? renderEmptyState("inspections") : (
            <div className="rounded-md border mt-2 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead className="hidden sm:table-cell">Location</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="hidden sm:table-cell">Inspector</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInspections.map(r => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/inspection/${r.id}`)}>
                      <TableCell className="font-medium text-sm">{r.organization || "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{r.location || "—"}</TableCell>
                      <TableCell className="text-sm font-mono text-muted-foreground">{formatDate(r.inspection_date)}</TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{getPersonName(r.inspector)}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "completed" ? "default" : "secondary"} className="text-xs">{r.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Trainings */}
      <Collapsible open={openSections.trainings} onOpenChange={() => toggleSection("trainings")}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full rounded-md border bg-muted/40 px-4 py-3 text-sm font-medium hover:bg-muted/60 transition-colors">
          <GraduationCap className="h-4 w-4 text-primary" />
          <span>Training Reports ({loadingTrainings ? "…" : filteredTrainings.length})</span>
          <SortButton sectionKey="trainings" />
          <ChevronDown className={cn("h-4 w-4 ml-auto transition-transform", openSections.trainings && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {loadingTrainings ? renderLoadingSkeleton() : !filteredTrainings.length ? renderEmptyState("training reports") : (
            <div className="rounded-md border mt-2 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead className="hidden sm:table-cell">Location</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="hidden sm:table-cell">Trainer</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTrainings.map(r => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/training/${r.id}`)}>
                      <TableCell className="font-medium text-sm">{r.organization || "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{r.location || "—"}</TableCell>
                      <TableCell className="text-sm font-mono text-muted-foreground">{formatDate(r.start_date)}</TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{getPersonName(r.trainer)}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "completed" ? "default" : "secondary"} className="text-xs">{r.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Daily Assessments */}
      <Collapsible open={openSections.dailyAssessments} onOpenChange={() => toggleSection("dailyAssessments")}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full rounded-md border bg-muted/40 px-4 py-3 text-sm font-medium hover:bg-muted/60 transition-colors">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          <span>Daily Assessments ({loadingDaily ? "…" : filteredDaily.length})</span>
          <SortButton sectionKey="dailyAssessments" />
          <ChevronDown className={cn("h-4 w-4 ml-auto transition-transform", openSections.dailyAssessments && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {loadingDaily ? renderLoadingSkeleton() : !filteredDaily.length ? renderEmptyState("daily assessments") : (
            <div className="rounded-md border mt-2 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead className="hidden sm:table-cell">Site</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="hidden sm:table-cell">Inspector</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDaily.map(r => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/daily-assessment/${r.id}`)}>
                      <TableCell className="font-medium text-sm">{r.organization || "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{r.site || "—"}</TableCell>
                      <TableCell className="text-sm font-mono text-muted-foreground">{formatDate(r.assessment_date)}</TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{getPersonName(r.inspector)}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "completed" ? "default" : "secondary"} className="text-xs">{r.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
