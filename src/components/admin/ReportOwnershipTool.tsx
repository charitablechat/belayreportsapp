import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, AlertTriangle, Check, UserCog, RefreshCw, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { format } from "date-fns";

interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
}

interface ReportWithOwnership {
  id: string;
  organization: string;
  expectedOwner: string; // trainer_of_record or similar
  currentOwner: string; // profile name from inspector_id
  currentOwnerId: string;
  isMatch: boolean;
  date: string;
  type: 'training' | 'inspection' | 'daily_assessment';
  status: string;
}

const normalizeForComparison = (str: string): string => {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
};

const checkNameMatch = (profileName: string, recordName: string): boolean => {
  if (!profileName || !recordName) return !recordName; // If no record name, it's a match (not set)
  
  const normalizedProfile = normalizeForComparison(profileName);
  const normalizedRecord = normalizeForComparison(recordName);
  
  if (normalizedProfile === normalizedRecord) return true;
  if (normalizedProfile.includes(normalizedRecord)) return true;
  if (normalizedRecord.includes(normalizedProfile)) return true;
  
  // Check if first+last name parts match
  const profileParts = normalizedProfile.split(' ');
  const recordParts = normalizedRecord.split(' ');
  
  // If one is a subset of the other
  const allProfilePartsMatch = profileParts.every(p => recordParts.some(r => r.includes(p) || p.includes(r)));
  const allRecordPartsMatch = recordParts.every(r => profileParts.some(p => p.includes(r) || r.includes(p)));
  
  return allProfilePartsMatch || allRecordPartsMatch;
};

export function ReportOwnershipTool() {
  const queryClient = useQueryClient();
  const [selectedReport, setSelectedReport] = useState<ReportWithOwnership | null>(null);
  const [newOwnerId, setNewOwnerId] = useState<string>("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [showOnlyMismatches, setShowOnlyMismatches] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterByUserId, setFilterByUserId] = useState<string>("all");

  // Fetch all profiles
  const { data: profiles, isLoading: profilesLoading } = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .order("first_name");
      
      if (error) throw error;
      return data as Profile[];
    },
  });

  // Fetch trainings with profile info
  const { data: trainings, isLoading: trainingsLoading, refetch: refetchTrainings } = useQuery({
    queryKey: ["admin-trainings-ownership"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trainings")
        .select(`
          id,
          organization,
          trainer_of_record,
          inspector_id,
          start_date,
          status,
          inspector:profiles!trainings_inspector_id_profiles_fkey(first_name, last_name)
        `)
        .order("start_date", { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  // Fetch inspections with profile info
  const { data: inspections, isLoading: inspectionsLoading, refetch: refetchInspections } = useQuery({
    queryKey: ["admin-inspections-ownership"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inspections")
        .select(`
          id,
          organization,
          location,
          previous_inspector,
          inspector_id,
          inspection_date,
          status,
          inspector:profiles!inspections_inspector_id_profiles_fkey(first_name, last_name)
        `)
        .order("inspection_date", { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  // Fetch daily assessments with profile info
  const { data: dailyAssessments, isLoading: dailyLoading, refetch: refetchDaily } = useQuery({
    queryKey: ["admin-daily-ownership"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_assessments")
        .select(`
          id,
          organization,
          site,
          trainer_of_record,
          inspector_id,
          assessment_date,
          status,
          inspector:profiles!daily_assessments_inspector_id_profiles_fkey(first_name, last_name)
        `)
        .order("assessment_date", { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  // Process trainings for ownership issues
  const trainingReports: ReportWithOwnership[] = useMemo(() => {
    if (!trainings) return [];
    
    return trainings.map((t: any) => {
      const profileName = t.inspector 
        ? `${t.inspector.first_name || ''} ${t.inspector.last_name || ''}`.trim()
        : 'Unknown';
      const trainerOfRecord = t.trainer_of_record?.trim() || '';
      
      return {
        id: t.id,
        organization: t.organization || 'N/A',
        expectedOwner: trainerOfRecord || '(not set)',
        currentOwner: profileName,
        currentOwnerId: t.inspector_id,
        isMatch: checkNameMatch(profileName, trainerOfRecord),
        date: t.start_date,
        type: 'training' as const,
        status: t.status,
      };
    });
  }, [trainings]);

  // Process inspections - they don't have trainer_of_record, so we just list them
  const inspectionReports: ReportWithOwnership[] = useMemo(() => {
    if (!inspections) return [];
    
    return inspections.map((i: any) => {
      const profileName = i.inspector 
        ? `${i.inspector.first_name || ''} ${i.inspector.last_name || ''}`.trim()
        : 'Unknown';
      
      return {
        id: i.id,
        organization: i.organization || 'N/A',
        expectedOwner: i.location || '(no location)',
        currentOwner: profileName,
        currentOwnerId: i.inspector_id,
        isMatch: true, // Inspections don't have a trainer_of_record to compare
        date: i.inspection_date,
        type: 'inspection' as const,
        status: i.status,
      };
    });
  }, [inspections]);

  // Process daily assessments
  const dailyReports: ReportWithOwnership[] = useMemo(() => {
    if (!dailyAssessments) return [];
    
    return dailyAssessments.map((d: any) => {
      const profileName = d.inspector 
        ? `${d.inspector.first_name || ''} ${d.inspector.last_name || ''}`.trim()
        : 'Unknown';
      const trainerOfRecord = d.trainer_of_record?.trim() || '';
      
      return {
        id: d.id,
        organization: d.organization || 'N/A',
        expectedOwner: trainerOfRecord || '(not set)',
        currentOwner: profileName,
        currentOwnerId: d.inspector_id,
        isMatch: checkNameMatch(profileName, trainerOfRecord),
        date: d.assessment_date,
        type: 'daily_assessment' as const,
        status: d.status,
      };
    });
  }, [dailyAssessments]);

  const trainingMismatches = trainingReports.filter(r => !r.isMatch);
  const dailyMismatches = dailyReports.filter(r => !r.isMatch);
  const totalMismatches = trainingMismatches.length + dailyMismatches.length;

  const handleReassign = (report: ReportWithOwnership) => {
    setSelectedReport(report);
    setNewOwnerId("");
  };

  const handleConfirmReassign = async () => {
    if (!selectedReport || !newOwnerId) return;
    
    setIsUpdating(true);
    try {
      let error: unknown = null;
      let affected: { id: string } | null = null;

      if (selectedReport.type === 'training') {
        const result = await supabase
          .from('trainings')
          .update({ inspector_id: newOwnerId })
          .eq('id', selectedReport.id)
          .select('id')
          .maybeSingle();
        error = result.error;
        affected = result.data;
      } else if (selectedReport.type === 'inspection') {
        const result = await supabase
          .from('inspections')
          .update({ inspector_id: newOwnerId })
          .eq('id', selectedReport.id)
          .select('id')
          .maybeSingle();
        error = result.error;
        affected = result.data;
      } else {
        const result = await supabase
          .from('daily_assessments')
          .update({ inspector_id: newOwnerId })
          .eq('id', selectedReport.id)
          .select('id')
          .maybeSingle();
        error = result.error;
        affected = result.data;
      }

      if (error) throw error;
      if (!affected) {
        // RLS filtered the row — the update silently did nothing.
        throw new Error("Permission denied or record no longer exists. No rows were updated.");
      }
      
      toast.success("Ownership reassigned successfully");
      setSelectedReport(null);
      setConfirmDialogOpen(false);
      
      // Refetch data
      await Promise.all([refetchTrainings(), refetchInspections(), refetchDaily()]);
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      
    } catch (error: any) {
      toast.error("Failed to reassign ownership", { description: error.message });
    } finally {
      setIsUpdating(false);
    }
  };

  const getNewOwnerName = () => {
    if (!newOwnerId || !profiles) return "";
    const profile = profiles.find(p => p.id === newOwnerId);
    return profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : "";
  };

  const isLoading = profilesLoading || trainingsLoading || inspectionsLoading || dailyLoading;

  const applyFilters = (reports: ReportWithOwnership[]) => {
    let filtered = reports;
    if (showOnlyMismatches) filtered = filtered.filter(r => !r.isMatch);
    if (filterByUserId && filterByUserId !== "all") filtered = filtered.filter(r => r.currentOwnerId === filterByUserId);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(r =>
        r.organization.toLowerCase().includes(q) ||
        r.currentOwner.toLowerCase().includes(q) ||
        r.expectedOwner.toLowerCase().includes(q)
      );
    }
    return filtered;
  };

  const renderReportTable = (reports: ReportWithOwnership[], showExpected: boolean = true) => {
    const filteredReports = applyFilters(reports);
    
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            {showExpected && <TableHead>Trainer of Record</TableHead>}
            <TableHead>Current Owner</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredReports.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showExpected ? 6 : 5} className="text-center text-muted-foreground py-8">
                {showOnlyMismatches ? "No mismatches detected" : "No reports found"}
              </TableCell>
            </TableRow>
          ) : (
            filteredReports.map((report) => (
              <TableRow key={report.id}>
                <TableCell className="font-medium">{report.organization}</TableCell>
                {showExpected && (
                  <TableCell>
                    <span className={!report.isMatch ? "text-amber-600 dark:text-amber-400 font-medium" : ""}>
                      {report.expectedOwner}
                    </span>
                  </TableCell>
                )}
                <TableCell>
                  <div className="flex items-center gap-2">
                    {report.currentOwner}
                    {!report.isMatch && (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={report.status === 'completed' ? 'default' : 'outline'}>
                    {report.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {format(new Date(report.date), "PP")}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleReassign(report)}
                  >
                    <UserCog className="h-4 w-4 mr-1" />
                    Reassign
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <UserCog className="h-5 w-5" />
                Report Ownership Tool
              </CardTitle>
              <CardDescription>
                Detect and fix ownership mismatches where trainer_of_record doesn't match the assigned owner
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetchTrainings();
                refetchInspections();
                refetchDaily();
              }}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">{trainingReports.length}</div>
              <div className="text-sm text-muted-foreground">Training Reports</div>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">{inspectionReports.length}</div>
              <div className="text-sm text-muted-foreground">Inspections</div>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">{dailyReports.length}</div>
              <div className="text-sm text-muted-foreground">Daily Assessments</div>
            </div>
            <div className={`p-4 rounded-lg ${totalMismatches > 0 ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-green-100 dark:bg-green-900/30'}`}>
              <div className="flex items-center gap-2">
                <div className="text-2xl font-bold">{totalMismatches}</div>
                {totalMismatches > 0 ? (
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                ) : (
                  <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
                )}
              </div>
              <div className="text-sm text-muted-foreground">Mismatches Found</div>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="space-y-3 mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by organization, owner, or trainer of record..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-9"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setSearchQuery('')}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={filterByUserId} onValueChange={setFilterByUserId}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Filter by user..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  {profiles?.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {`${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant={showOnlyMismatches ? "default" : "outline"}
                size="sm"
                onClick={() => setShowOnlyMismatches(true)}
              >
                <AlertTriangle className="h-4 w-4 mr-1" />
                Mismatches Only
              </Button>
              <Button
                variant={!showOnlyMismatches ? "default" : "outline"}
                size="sm"
                onClick={() => setShowOnlyMismatches(false)}
              >
                Show All
              </Button>
            </div>
          </div>

          {/* Report Tabs */}
          <Tabs defaultValue="trainings" className="space-y-4">
            <TabsList>
              <TabsTrigger value="trainings" className="flex items-center gap-2">
                Trainings
                {trainingMismatches.length > 0 && (
                  <Badge variant="destructive" className="text-xs">{trainingMismatches.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="inspections">Inspections</TabsTrigger>
              <TabsTrigger value="daily" className="flex items-center gap-2">
                Daily Assessments
                {dailyMismatches.length > 0 && (
                  <Badge variant="destructive" className="text-xs">{dailyMismatches.length}</Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="trainings">
              <div className="rounded-md border">
                {renderReportTable(trainingReports)}
              </div>
            </TabsContent>

            <TabsContent value="inspections">
              <div className="rounded-md border">
                {renderReportTable(inspectionReports, false)}
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Inspections don't have a trainer_of_record field, so mismatches can't be auto-detected. 
                You can still reassign ownership manually.
              </p>
            </TabsContent>

            <TabsContent value="daily">
              <div className="rounded-md border">
                {renderReportTable(dailyReports)}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Reassign Dialog */}
      {selectedReport && (
        <AlertDialog open={!!selectedReport} onOpenChange={(open) => !open && setSelectedReport(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reassign Report Ownership</AlertDialogTitle>
              <AlertDialogDescription>
                <div className="space-y-3 mt-2">
                  <div>
                    <span className="font-medium">Organization:</span> {selectedReport.organization}
                  </div>
                  <div>
                    <span className="font-medium">Current Owner:</span> {selectedReport.currentOwner}
                  </div>
                  {selectedReport.type !== 'inspection' && (
                    <div>
                      <span className="font-medium">Trainer of Record:</span> {selectedReport.expectedOwner}
                    </div>
                  )}
                  <div className="pt-2">
                    <label className="font-medium block mb-2">Select New Owner:</label>
                    <Select value={newOwnerId} onValueChange={setNewOwnerId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a user..." />
                      </SelectTrigger>
                      <SelectContent>
                        {profiles?.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {`${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isUpdating}>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleConfirmReassign}
                disabled={!newOwnerId || isUpdating}
              >
                {isUpdating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  `Reassign to ${getNewOwnerName() || '...'}`
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
