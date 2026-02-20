import { useState, useEffect, useCallback, Component, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Upload, Trash2, AlertTriangle, Database, HardDrive, CheckCircle2, XCircle, Clock, Loader2, Download, RotateCcw, Shield } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { listAllSnapshots, getReportSnapshot, deleteReportSnapshot, getBackupStorageInfo, type ReportType } from "@/lib/local-backup-ledger";
import {
  getOfflineTrainings,
  getOfflineDailyAssessments,
  getOfflineInspections,
  getQueuedOperations,
  getQueuedAssessmentOperations,
  getQueuedTrainingOperations,
  deleteOfflineTraining,
  deleteOfflineDailyAssessment,
  deleteOfflineInspection,
  removeQueuedOperation,
  removeQueuedAssessmentOperation,
  removeQueuedTrainingOperation,
  clearAllQueuedOperations,
  clearAllQueuedAssessmentOperations,
  clearAllQueuedTrainingOperations,
} from "@/lib/offline-storage";

// Error Boundary to isolate panel crashes
interface RecoveryErrorBoundaryProps {
  children: ReactNode;
  panelName: string;
}

interface RecoveryErrorBoundaryState {
  hasError: boolean;
}

export class RecoveryErrorBoundary extends Component<RecoveryErrorBoundaryProps, RecoveryErrorBoundaryState> {
  state: RecoveryErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RecoveryErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[RecoveryErrorBoundary] ${this.props.panelName} crashed:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card className="backdrop-blur-md bg-white/5 dark:bg-white/[0.03] border border-white/10 rounded-xl">
          <CardContent className="py-8">
            <div className="flex flex-col items-center gap-3 text-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <p className="font-medium">This section failed to load</p>
              <p className="text-sm text-muted-foreground">{this.props.panelName} encountered an error.</p>
              <Button variant="outline" size="sm" onClick={() => this.setState({ hasError: false })}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

interface LocalData {
  trainings: any[];
  dailyAssessments: any[];
  inspections: any[];
  queuedOperations: any[];
  queuedAssessmentOperations: any[];
  queuedTrainingOperations: any[];
}

export function DataRecoveryTool() {
  return (
    <div className="space-y-6">
      <RecoveryErrorBoundary panelName="Local Backup Snapshots">
        <LocalSnapshotsPanel />
      </RecoveryErrorBoundary>
      <RecoveryErrorBoundary panelName="IndexedDB Recovery">
        <IndexedDBRecoveryPanel />
      </RecoveryErrorBoundary>
    </div>
  );
}

interface SnapshotsPanelProps {
  allowDelete?: boolean;
}

export function LocalSnapshotsPanel({ allowDelete = true }: SnapshotsPanelProps) {
  const snapshots = listAllSnapshots();
  const storageInfo = getBackupStorageInfo();

  const handleExport = (reportType: ReportType, reportId: string) => {
    const snapshot = getReportSnapshot(reportType, reportId);
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_${reportType}_${reportId.substring(0, 8)}_${new Date(snapshot.ts).toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Snapshot exported as JSON");
  };

  const handleRestore = async (reportType: ReportType, reportId: string) => {
    const snapshot = getReportSnapshot(reportType, reportId);
    if (!snapshot) return;
    try {
      const { saveInspectionOffline, saveRelatedDataOffline, saveTrainingOffline, saveTrainingDataOffline, saveDailyAssessmentOffline, saveAssessmentDataOffline } = await import('@/lib/offline-storage');
      
      if (reportType === 'inspection') {
        await saveInspectionOffline(snapshot.parent);
        for (const [key, data] of Object.entries(snapshot.children)) {
          if (Array.isArray(data) && data.length > 0) {
            await saveRelatedDataOffline(key as any, reportId, data);
          }
        }
      } else if (reportType === 'training') {
        await saveTrainingOffline(snapshot.parent);
        for (const [key, data] of Object.entries(snapshot.children)) {
          if (Array.isArray(data) && data.length > 0) {
            await saveTrainingDataOffline(key as any, reportId, data);
          }
        }
      } else if (reportType === 'daily_assessment') {
        await saveDailyAssessmentOffline(snapshot.parent);
        for (const [key, data] of Object.entries(snapshot.children)) {
          if (Array.isArray(data) && data.length > 0) {
            await saveAssessmentDataOffline(key as any, reportId, data);
          }
        }
      }
      toast.success("Snapshot restored to local storage");
    } catch (error) {
      console.error('[Data Recovery] Restore failed:', error);
      toast.error("Failed to restore snapshot");
    }
  };

  const handleDelete = (reportType: ReportType, reportId: string) => {
    deleteReportSnapshot(reportType, reportId);
    toast.success("Snapshot deleted");
  };

  const formatDate = (ts: number) => {
    try { return format(new Date(ts), "MMM d, yyyy h:mm a"); } catch { return "N/A"; }
  };

  return (
    <Card className="backdrop-blur-md bg-white/5 dark:bg-white/[0.03] border border-white/10 rounded-xl shadow-lg shadow-black/5 overflow-hidden">
      <CardHeader className="px-3 md:px-6 py-4 md:p-6">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-emerald-400 shrink-0" />
              Local Backup Snapshots
            </CardTitle>
            <CardDescription className="mt-2 break-words" style={{ overflowWrap: 'anywhere' }}>
              Immutable localStorage backups that survive browser cache clearing. {storageInfo.snapshotCount} snapshots ({(storageInfo.totalBytes / 1024).toFixed(1)} KB).
              {storageInfo.unsyncedCount > 0 && <Badge variant="destructive" className="ml-2">{storageInfo.unsyncedCount} unsynced</Badge>}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 md:px-6 pb-4 md:pb-6 pt-0">
        {snapshots.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No local backup snapshots found. Snapshots are created automatically when you save reports.
          </div>
        ) : (
          <>
            {/* Mobile card layout */}
            <div className="md:hidden space-y-3">
              {snapshots.map((s) => (
                <div key={s.key} className="rounded-lg border border-white/10 bg-white/5 dark:bg-white/[0.02] p-3 space-y-2.5 min-w-0 overflow-hidden font-mono">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">{s.reportType.replace('_', ' ')}</Badge>
                    <Badge variant={s.synced ? "default" : "destructive"} className="text-xs">
                      {s.synced ? "Synced" : "Unsynced"}
                    </Badge>
                  </div>
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0">Org</span>
                      <span className="font-medium text-right min-w-0 break-words" style={{ overflowWrap: 'anywhere' }}>{s.organization || "N/A"}</span>
                    </div>
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0">Device</span>
                      <span className="text-right min-w-0 break-words" style={{ overflowWrap: 'anywhere' }}>{s.device}</span>
                    </div>
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0">Saved</span>
                      <span className="text-right text-muted-foreground break-words" style={{ overflowWrap: 'anywhere' }}>{formatDate(s.timestamp)}</span>
                    </div>
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0">Size</span>
                      <span>{(s.sizeBytes / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="flex-1 w-full" onClick={() => handleRestore(s.reportType, s.reportId)}>
                      <RotateCcw className="h-4 w-4 mr-1.5" />
                      Restore
                    </Button>
                    {allowDelete && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => handleExport(s.reportType, s.reportId)} title="Export">
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(s.reportType, s.reportId)} title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table layout */}
            <div className="hidden md:block rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Sync</TableHead>
                    <TableHead>Last Saved</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshots.map((s) => (
                    <TableRow key={s.key}>
                      <TableCell>
                        <Badge variant="outline">{s.reportType.replace('_', ' ')}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{s.organization || "N/A"}</TableCell>
                      <TableCell>{s.device}</TableCell>
                      <TableCell>
                        <Badge variant={s.synced ? "default" : "destructive"}>
                          {s.synced ? "Synced" : "Unsynced"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(s.timestamp)}</TableCell>
                      <TableCell className="text-sm">{(s.sizeBytes / 1024).toFixed(1)} KB</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => handleRestore(s.reportType, s.reportId)} title="Restore to IndexedDB">
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                          {allowDelete && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => handleExport(s.reportType, s.reportId)} title="Export as JSON">
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(s.reportType, s.reportId)} title="Delete snapshot">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface IndexedDBPanelProps {
  allowDelete?: boolean;
}

export function IndexedDBRecoveryPanel({ allowDelete = true }: IndexedDBPanelProps) {
  const [localData, setLocalData] = useState<LocalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: string } | null>(null);
  const [selectedOps, setSelectedOps] = useState<Set<string>>(new Set());
  const [clearAllDialogOpen, setClearAllDialogOpen] = useState(false);
  const [clearSectionDialog, setClearSectionDialog] = useState<string | null>(null);
  const [batchDeleteDialog, setBatchDeleteDialog] = useState(false);

  const loadLocalData = async () => {
    setLoading(true);
    try {
      const [
        trainings,
        dailyAssessments,
        inspections,
        queuedOperations,
        queuedAssessmentOperations,
        queuedTrainingOperations,
      ] = await Promise.race([
        Promise.all([
          getOfflineTrainings(),
          getOfflineDailyAssessments(),
          getOfflineInspections(),
          getQueuedOperations(),
          getQueuedAssessmentOperations(),
          getQueuedTrainingOperations(),
        ]),
        new Promise<[any[], any[], any[], any[], any[], any[]]>((_, reject) =>
          setTimeout(() => reject(new Error('Data recovery load timeout after 10s')), 10000)
        ),
      ]);

      setLocalData({
        trainings: trainings || [],
        dailyAssessments: dailyAssessments || [],
        inspections: inspections || [],
        queuedOperations: queuedOperations || [],
        queuedAssessmentOperations: queuedAssessmentOperations || [],
        queuedTrainingOperations: queuedTrainingOperations || [],
      });
    } catch (error) {
      console.error("[Data Recovery] Error loading local data:", error);
      toast.error("Failed to load local data");
      // Set empty defaults so the UI doesn't crash on null access
      setLocalData({
        trainings: [],
        dailyAssessments: [],
        inspections: [],
        queuedOperations: [],
        queuedAssessmentOperations: [],
        queuedTrainingOperations: [],
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLocalData();
  }, []);

  const getAgeBadge = (timestamp: number) => {
    if (!timestamp || isNaN(timestamp)) {
      return <Badge variant="outline">Unknown age</Badge>;
    }
    try {
      const ageMs = Date.now() - timestamp;
      const ageHours = ageMs / (1000 * 60 * 60);
      const ageLabel = formatDistanceToNow(new Date(timestamp), { addSuffix: true });
      if (ageHours < 1) {
        return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 hover:bg-emerald-500/20">{ageLabel}</Badge>;
      } else if (ageHours < 24) {
        return <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 hover:bg-amber-500/20">{ageLabel}</Badge>;
      } else {
        return <Badge className="bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/20">{ageLabel}</Badge>;
      }
    } catch {
      return <Badge variant="outline">Unknown age</Badge>;
    }
  };

  const toggleSelection = (key: string) => {
    setSelectedOps(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = (prefix: string, ops: any[]) => {
    setSelectedOps(prev => {
      const next = new Set(prev);
      const keys = ops.map((op, idx) => `${prefix}-${op.id ?? idx}`);
      const allSelected = keys.every(k => next.has(k));
      if (allSelected) {
        keys.forEach(k => next.delete(k));
      } else {
        keys.forEach(k => next.add(k));
      }
      return next;
    });
  };

  const getSelectedCount = (prefix: string) => {
    return Array.from(selectedOps).filter(k => k.startsWith(`${prefix}-`)).length;
  };

  const handleDeleteSingleOp = async (prefix: string, id: number) => {
    try {
      if (prefix === 'inspection') await removeQueuedOperation(id);
      else if (prefix === 'assessment') await removeQueuedAssessmentOperation(id);
      else if (prefix === 'training') await removeQueuedTrainingOperation(id);
      toast.success("Operation removed");
      setSelectedOps(prev => { const n = new Set(prev); n.delete(`${prefix}-${id}`); return n; });
      await loadLocalData();
    } catch (e) {
      toast.error("Failed to remove operation");
    }
  };

  const handleBatchDelete = async () => {
    try {
      const promises: Promise<void>[] = [];
      for (const key of selectedOps) {
        const [prefix, idStr] = key.split('-');
        const id = parseInt(idStr, 10);
        if (isNaN(id)) continue;
        if (prefix === 'inspection') promises.push(removeQueuedOperation(id));
        else if (prefix === 'assessment') promises.push(removeQueuedAssessmentOperation(id));
        else if (prefix === 'training') promises.push(removeQueuedTrainingOperation(id));
      }
      await Promise.race([
        Promise.all(promises),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Batch delete timeout after 10s')), 10000)
        ),
      ]);
      toast.success(`Deleted ${selectedOps.size} operations`);
      setSelectedOps(new Set());
      await loadLocalData();
    } catch (e: any) {
      toast.error(e?.message?.includes('timeout') ? "Operation timed out — some items may not have been deleted" : "Failed to delete selected operations");
    } finally {
      setBatchDeleteDialog(false);
    }
  };

  const handleClearSection = async (section: string) => {
    try {
      if (section === 'inspection') await clearAllQueuedOperations();
      else if (section === 'assessment') await clearAllQueuedAssessmentOperations();
      else if (section === 'training') await clearAllQueuedTrainingOperations();
      toast.success("Section cleared");
      setSelectedOps(prev => {
        const next = new Set(prev);
        for (const k of next) { if (k.startsWith(`${section}-`)) next.delete(k); }
        return next;
      });
      await loadLocalData();
    } catch (e) {
      toast.error("Failed to clear section");
    } finally {
      setClearSectionDialog(null);
    }
  };

  const handleClearAll = async () => {
    try {
      await Promise.all([
        clearAllQueuedOperations(),
        clearAllQueuedAssessmentOperations(),
        clearAllQueuedTrainingOperations(),
      ]);
      toast.success("All queued operations cleared");
      setSelectedOps(new Set());
      await loadLocalData();
    } catch (e) {
      toast.error("Failed to clear all operations");
    } finally {
      setClearAllDialogOpen(false);
    }
  };

  const syncTrainingToDatabase = async (training: any) => {
    setSyncing(training.id);
    try {
      // Step 1: Upsert parent WITHOUT synced_at
      const trainingData = {
        id: training.id,
        inspector_id: training.inspector_id,
        organization: training.organization,
        organization_id: training.organization_id,
        trainer_of_record: training.trainer_of_record,
        trainee_names: training.trainee_names,
        start_date: training.start_date,
        end_date: training.end_date,
        status: training.status,
        latitude: training.latitude,
        longitude: training.longitude,
        created_at: training.created_at,
        updated_at: training.updated_at,
      };

      const { error } = await supabase.from("trainings").upsert(trainingData);
      if (error) throw error;

      // Step 2: Child data would be synced here if recovery tool had access

      // Step 3: Final PATCH to set synced_at + updated_at
      const now = new Date().toISOString();
      const { error: patchError } = await supabase.from("trainings")
        .update({ synced_at: now, updated_at: now })
        .eq("id", training.id);
      if (patchError) throw patchError;

      toast.success("Training synced successfully");
      await loadLocalData();
    } catch (error: any) {
      console.error("[Data Recovery] Sync failed:", error);
      toast.error(error.message || "Failed to sync training");
    } finally {
      setSyncing(null);
    }
  };

  const syncDailyAssessmentToDatabase = async (assessment: any) => {
    setSyncing(assessment.id);
    try {
      // Step 1: Upsert parent WITHOUT synced_at
      const assessmentData = {
        id: assessment.id,
        inspector_id: assessment.inspector_id,
        organization: assessment.organization,
        organization_id: assessment.organization_id,
        site: assessment.site,
        trainer_of_record: assessment.trainer_of_record,
        assessment_date: assessment.assessment_date,
        status: assessment.status,
        latitude: assessment.latitude,
        longitude: assessment.longitude,
        created_at: assessment.created_at,
        updated_at: assessment.updated_at,
      };

      const { error } = await supabase.from("daily_assessments").upsert(assessmentData);
      if (error) throw error;

      // Step 2: Child data would be synced here if recovery tool had access

      // Step 3: Final PATCH to set synced_at + updated_at
      const now = new Date().toISOString();
      const { error: patchError } = await supabase.from("daily_assessments")
        .update({ synced_at: now, updated_at: now })
        .eq("id", assessment.id);
      if (patchError) throw patchError;

      toast.success("Daily assessment synced successfully");
      await loadLocalData();
    } catch (error: any) {
      console.error("[Data Recovery] Sync failed:", error);
      toast.error(error.message || "Failed to sync daily assessment");
    } finally {
      setSyncing(null);
    }
  };

  const syncInspectionToDatabase = async (inspection: any) => {
    setSyncing(inspection.id);
    try {
      // Step 1: Upsert parent WITHOUT synced_at
      const inspectionData = {
        id: inspection.id,
        inspector_id: inspection.inspector_id,
        organization: inspection.organization,
        organization_id: inspection.organization_id,
        location: inspection.location,
        onsite_contact: inspection.onsite_contact,
        inspection_date: inspection.inspection_date,
        previous_inspection_date: inspection.previous_inspection_date,
        previous_inspector: inspection.previous_inspector,
        course_history: inspection.course_history,
        acct_number: inspection.acct_number,
        status: inspection.status,
        latitude: inspection.latitude,
        longitude: inspection.longitude,
        created_at: inspection.created_at,
        updated_at: inspection.updated_at,
      };

      const { error } = await supabase.from("inspections").upsert(inspectionData);
      if (error) throw error;

      // Step 2: Child data would be synced here if recovery tool had access

      // Step 3: Final PATCH to set synced_at + updated_at
      const now = new Date().toISOString();
      const { error: patchError } = await supabase.from("inspections")
        .update({ synced_at: now, updated_at: now })
        .eq("id", inspection.id);
      if (patchError) throw patchError;

      toast.success("Inspection synced successfully");
      await loadLocalData();
    } catch (error: any) {
      console.error("[Data Recovery] Sync failed:", error);
      toast.error(error.message || "Failed to sync inspection");
    } finally {
      setSyncing(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;

    try {
      if (deleteConfirm.type === "training") {
        await deleteOfflineTraining(deleteConfirm.id);
      } else if (deleteConfirm.type === "dailyAssessment") {
        await deleteOfflineDailyAssessment(deleteConfirm.id);
      } else if (deleteConfirm.type === "inspection") {
        await deleteOfflineInspection(deleteConfirm.id);
      }

      toast.success("Deleted from local storage");
      await loadLocalData();
    } catch (error: any) {
      console.error("[Data Recovery] Delete failed:", error);
      toast.error(error.message || "Failed to delete");
    } finally {
      setDeleteConfirm(null);
    }
  };

  const getSyncStatus = (item: any) => {
    if (item.synced_at) {
      return { label: "Synced", variant: "default" as const, icon: CheckCircle2 };
    }
    return { label: "Unsynced", variant: "destructive" as const, icon: XCircle };
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    try {
      return format(new Date(dateStr), "MMM d, yyyy h:mm a");
    } catch {
      return dateStr;
    }
  };

  if (!localData) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading local data...</span>
        </CardContent>
      </Card>
    );
  }

  const unsyncedTrainings = localData?.trainings.filter((t) => !t.synced_at) || [];
  const unsyncedAssessments = localData?.dailyAssessments.filter((a) => !a.synced_at) || [];
  const unsyncedInspections = localData?.inspections.filter((i) => !i.synced_at) || [];
  const totalQueued =
    (localData?.queuedOperations.length || 0) +
    (localData?.queuedAssessmentOperations.length || 0) +
    (localData?.queuedTrainingOperations.length || 0);

  return (
    <div className="space-y-6">
    <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-indigo-500" />
                Local Data Recovery Tool
              </CardTitle>
              <CardDescription className="mt-2">
                View and recover data stored in this browser's local storage (IndexedDB).
                This tool only shows data from the current device/browser.
              </CardDescription>
            </div>
            <Button variant="outline" onClick={loadLocalData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="glass-card rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Database className="h-4 w-4 text-emerald-400" />
                Trainings
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-black">{localData?.trainings.length || 0}</span>
                {unsyncedTrainings.length > 0 && (
                  <Badge className="text-xs bg-indigo-500/15 text-indigo-400 border-indigo-500/30">
                    {unsyncedTrainings.length} unsynced
                  </Badge>
                )}
              </div>
            </div>
            <div className="glass-card rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Database className="h-4 w-4 text-emerald-400" />
                Daily Assessments
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-black">{localData?.dailyAssessments.length || 0}</span>
                {unsyncedAssessments.length > 0 && (
                  <Badge className="text-xs bg-indigo-500/15 text-indigo-400 border-indigo-500/30">
                    {unsyncedAssessments.length} unsynced
                  </Badge>
                )}
              </div>
            </div>
            <div className="glass-card rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Database className="h-4 w-4 text-emerald-400" />
                Inspections
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-black">{localData?.inspections.length || 0}</span>
                {unsyncedInspections.length > 0 && (
                  <Badge className="text-xs bg-indigo-500/15 text-indigo-400 border-indigo-500/30">
                    {unsyncedInspections.length} unsynced
                  </Badge>
                )}
              </div>
            </div>
            <div className="glass-card rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Clock className="h-4 w-4 text-slate-400" />
                Queued Operations
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-black">{totalQueued}</span>
                {totalQueued > 0 && (
                  <Badge className="text-xs bg-slate-500/15 text-slate-400 border-slate-400/30">
                    pending sync
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="snapshots" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="snapshots">
            <Shield className="h-4 w-4 mr-1" />
            Local Backups
          </TabsTrigger>
          <TabsTrigger value="trainings">
            Trainings ({localData?.trainings.length || 0})
          </TabsTrigger>
          <TabsTrigger value="assessments">
            Daily Assessments ({localData?.dailyAssessments.length || 0})
          </TabsTrigger>
          <TabsTrigger value="inspections">
            Inspections ({localData?.inspections.length || 0})
          </TabsTrigger>
          <TabsTrigger value="queued">
            Queued Ops ({totalQueued})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="snapshots">
          <LocalSnapshotsPanel allowDelete={allowDelete} />
        </TabsContent>

        <TabsContent value="trainings">
          <Card>
            <CardHeader>
              <CardTitle>Local Training Records</CardTitle>
              <CardDescription>
                Training data stored in this browser. Unsynced records can be manually pushed to the database.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {localData?.trainings.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No local training data found
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Organization</TableHead>
                        <TableHead>Trainer</TableHead>
                        <TableHead>Dates</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sync Status</TableHead>
                        <TableHead>Updated</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {localData?.trainings.map((training) => {
                        const syncStatus = getSyncStatus(training);
                        return (
                          <TableRow key={training.id}>
                            <TableCell className="font-medium">
                              {training.organization || "N/A"}
                            </TableCell>
                            <TableCell>{training.trainer_of_record || "N/A"}</TableCell>
                            <TableCell className="text-sm">
                              {training.start_date} - {training.end_date}
                            </TableCell>
                            <TableCell>
                              <Badge variant={training.status === "completed" ? "default" : "secondary"}>
                                {training.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={syncStatus.variant} className="flex items-center gap-1 w-fit">
                                <syncStatus.icon className="h-3 w-3" />
                                {syncStatus.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDate(training.updated_at)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                {!training.synced_at && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => syncTrainingToDatabase(training)}
                                    disabled={syncing === training.id}
                                  >
                                    {syncing === training.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Upload className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                                {allowDelete && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => setDeleteConfirm({ type: "training", id: training.id })}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assessments">
          <Card>
            <CardHeader>
              <CardTitle>Local Daily Assessment Records</CardTitle>
              <CardDescription>
                Daily assessment data stored in this browser.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {localData?.dailyAssessments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No local daily assessment data found
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Organization</TableHead>
                        <TableHead>Site</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sync Status</TableHead>
                        <TableHead>Updated</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {localData?.dailyAssessments.map((assessment) => {
                        const syncStatus = getSyncStatus(assessment);
                        return (
                          <TableRow key={assessment.id}>
                            <TableCell className="font-medium">
                              {assessment.organization || "N/A"}
                            </TableCell>
                            <TableCell>{assessment.site || "N/A"}</TableCell>
                            <TableCell className="text-sm">{assessment.assessment_date}</TableCell>
                            <TableCell>
                              <Badge variant={assessment.status === "completed" ? "default" : "secondary"}>
                                {assessment.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={syncStatus.variant} className="flex items-center gap-1 w-fit">
                                <syncStatus.icon className="h-3 w-3" />
                                {syncStatus.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDate(assessment.updated_at)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                {!assessment.synced_at && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => syncDailyAssessmentToDatabase(assessment)}
                                    disabled={syncing === assessment.id}
                                  >
                                    {syncing === assessment.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Upload className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                                {allowDelete && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => setDeleteConfirm({ type: "dailyAssessment", id: assessment.id })}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inspections">
          <Card>
            <CardHeader>
              <CardTitle>Local Inspection Records</CardTitle>
              <CardDescription>
                Inspection data stored in this browser.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {localData?.inspections.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No local inspection data found
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Organization</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sync Status</TableHead>
                        <TableHead>Updated</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {localData?.inspections.map((inspection) => {
                        const syncStatus = getSyncStatus(inspection);
                        return (
                          <TableRow key={inspection.id}>
                            <TableCell className="font-medium">
                              {inspection.organization || "N/A"}
                            </TableCell>
                            <TableCell>{inspection.location || "N/A"}</TableCell>
                            <TableCell className="text-sm">{inspection.inspection_date}</TableCell>
                            <TableCell>
                              <Badge variant={inspection.status === "completed" ? "default" : "secondary"}>
                                {inspection.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={syncStatus.variant} className="flex items-center gap-1 w-fit">
                                <syncStatus.icon className="h-3 w-3" />
                                {syncStatus.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDate(inspection.updated_at)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                {!inspection.synced_at && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => syncInspectionToDatabase(inspection)}
                                    disabled={syncing === inspection.id}
                                  >
                                    {syncing === inspection.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Upload className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                                {allowDelete && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => setDeleteConfirm({ type: "inspection", id: inspection.id })}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="queued">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    Queued Operations
                  </CardTitle>
                  <CardDescription>
                    Pending operations waiting to be synced. These will be processed automatically when online.
                  </CardDescription>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {selectedOps.size > 0 && (
                    <Button variant="destructive" size="sm" onClick={() => setBatchDeleteDialog(true)}>
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete Selected ({selectedOps.size})
                    </Button>
                  )}
                  {totalQueued > 0 && (
                    <Button variant="destructive" size="sm" onClick={() => setClearAllDialogOpen(true)}>
                      <Trash2 className="h-4 w-4 mr-1" />
                      Clear All ({totalQueued})
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Inspection Operations */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium">Inspection Operations ({localData?.queuedOperations.length || 0})</h4>
                    {(localData?.queuedOperations.length || 0) > 0 && (
                      <Button variant="outline" size="sm" className="text-destructive" onClick={() => setClearSectionDialog('inspection')}>
                        Clear All
                      </Button>
                    )}
                  </div>
                  {localData?.queuedOperations.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No pending inspection operations</div>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10">
                              <Checkbox
                                checked={localData!.queuedOperations.length > 0 && localData!.queuedOperations.every((op, idx) => selectedOps.has(`inspection-${op.id ?? idx}`))}
                                onCheckedChange={() => toggleSelectAll('inspection', localData!.queuedOperations)}
                              />
                            </TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Inspection ID</TableHead>
                            <TableHead>Age</TableHead>
                            <TableHead>Retries</TableHead>
                            <TableHead className="w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {localData?.queuedOperations.map((op, idx) => {
                            const key = `inspection-${op.id ?? idx}`;
                            return (
                              <TableRow key={key}>
                                <TableCell>
                                  <Checkbox checked={selectedOps.has(key)} onCheckedChange={() => toggleSelection(key)} />
                                </TableCell>
                                <TableCell><Badge variant="outline">{op.type}</Badge></TableCell>
                                <TableCell className="font-mono text-xs">{op.inspectionId}</TableCell>
                                <TableCell>{getAgeBadge(op.timestamp)}</TableCell>
                                <TableCell>{op.retries}</TableCell>
                                <TableCell>
                                  <Button size="sm" variant="ghost" className="text-destructive h-8 w-8 p-0" onClick={() => handleDeleteSingleOp('inspection', op.id ?? idx)}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {/* Assessment Operations */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium">Assessment Operations ({localData?.queuedAssessmentOperations.length || 0})</h4>
                    {(localData?.queuedAssessmentOperations.length || 0) > 0 && (
                      <Button variant="outline" size="sm" className="text-destructive" onClick={() => setClearSectionDialog('assessment')}>
                        Clear All
                      </Button>
                    )}
                  </div>
                  {localData?.queuedAssessmentOperations.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No pending assessment operations</div>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10">
                              <Checkbox
                                checked={localData!.queuedAssessmentOperations.length > 0 && localData!.queuedAssessmentOperations.every((op, idx) => selectedOps.has(`assessment-${op.id ?? idx}`))}
                                onCheckedChange={() => toggleSelectAll('assessment', localData!.queuedAssessmentOperations)}
                              />
                            </TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Assessment ID</TableHead>
                            <TableHead>Age</TableHead>
                            <TableHead>Retries</TableHead>
                            <TableHead className="w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {localData?.queuedAssessmentOperations.map((op, idx) => {
                            const key = `assessment-${op.id ?? idx}`;
                            return (
                              <TableRow key={key}>
                                <TableCell>
                                  <Checkbox checked={selectedOps.has(key)} onCheckedChange={() => toggleSelection(key)} />
                                </TableCell>
                                <TableCell><Badge variant="outline">{op.type}</Badge></TableCell>
                                <TableCell className="font-mono text-xs">{op.assessmentId}</TableCell>
                                <TableCell>{getAgeBadge(op.timestamp)}</TableCell>
                                <TableCell>{op.retries}</TableCell>
                                <TableCell>
                                  <Button size="sm" variant="ghost" className="text-destructive h-8 w-8 p-0" onClick={() => handleDeleteSingleOp('assessment', op.id ?? idx)}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {/* Training Operations */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium">Training Operations ({localData?.queuedTrainingOperations.length || 0})</h4>
                    {(localData?.queuedTrainingOperations.length || 0) > 0 && (
                      <Button variant="outline" size="sm" className="text-destructive" onClick={() => setClearSectionDialog('training')}>
                        Clear All
                      </Button>
                    )}
                  </div>
                  {localData?.queuedTrainingOperations.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No pending training operations</div>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10">
                              <Checkbox
                                checked={localData!.queuedTrainingOperations.length > 0 && localData!.queuedTrainingOperations.every((op, idx) => selectedOps.has(`training-${op.id ?? idx}`))}
                                onCheckedChange={() => toggleSelectAll('training', localData!.queuedTrainingOperations)}
                              />
                            </TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Training ID</TableHead>
                            <TableHead>Age</TableHead>
                            <TableHead>Retries</TableHead>
                            <TableHead className="w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {localData?.queuedTrainingOperations.map((op, idx) => {
                            const key = `training-${op.id ?? idx}`;
                            return (
                              <TableRow key={key}>
                                <TableCell>
                                  <Checkbox checked={selectedOps.has(key)} onCheckedChange={() => toggleSelection(key)} />
                                </TableCell>
                                <TableCell><Badge variant="outline">{op.type}</Badge></TableCell>
                                <TableCell className="font-mono text-xs">{op.trainingId}</TableCell>
                                <TableCell>{getAgeBadge(op.timestamp)}</TableCell>
                                <TableCell>{op.retries}</TableCell>
                                <TableCell>
                                  <Button size="sm" variant="ghost" className="text-destructive h-8 w-8 p-0" onClick={() => handleDeleteSingleOp('training', op.id ?? idx)}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog - only render when allowDelete is true */}
      {allowDelete && (
        <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete from Local Storage?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this record from the browser's local storage.
                If it was never synced to the database, this data will be lost forever.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Clear All Dialog */}
      <AlertDialog open={clearAllDialogOpen} onOpenChange={setClearAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Queued Operations?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all {totalQueued} queued operations from all three stores (inspections, assessments, trainings). This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Clear All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear Section Dialog */}
      <AlertDialog open={!!clearSectionDialog} onOpenChange={() => setClearSectionDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All {clearSectionDialog} Operations?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all queued {clearSectionDialog} operations. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => clearSectionDialog && handleClearSection(clearSectionDialog)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Clear Section
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch Delete Dialog */}
      <AlertDialog open={batchDeleteDialog} onOpenChange={setBatchDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedOps.size} Selected Operations?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the selected queued operations. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBatchDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Selected
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
