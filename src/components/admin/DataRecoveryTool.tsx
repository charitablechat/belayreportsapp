import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Upload, Trash2, AlertTriangle, Database, HardDrive, CheckCircle2, XCircle, Clock, Loader2, Download, RotateCcw, Shield } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
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
} from "@/lib/offline-storage";

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
      <LocalSnapshotsPanel />
      <IndexedDBRecoveryPanel />
    </div>
  );
}

function LocalSnapshotsPanel() {
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Local Backup Snapshots
            </CardTitle>
            <CardDescription className="mt-2">
              Immutable localStorage backups that survive browser cache clearing. {storageInfo.snapshotCount} snapshots ({(storageInfo.totalBytes / 1024).toFixed(1)} KB).
              {storageInfo.unsyncedCount > 0 && <Badge variant="destructive" className="ml-2">{storageInfo.unsyncedCount} unsynced</Badge>}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {snapshots.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No local backup snapshots found. Snapshots are created automatically when you save reports.
          </div>
        ) : (
          <div className="rounded-md border">
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
                        <Button size="sm" variant="outline" onClick={() => handleExport(s.reportType, s.reportId)} title="Export as JSON">
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(s.reportType, s.reportId)} title="Delete snapshot">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IndexedDBRecoveryPanel() {
  const [localData, setLocalData] = useState<LocalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: string } | null>(null);

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
      ] = await Promise.all([
        getOfflineTrainings(),
        getOfflineDailyAssessments(),
        getOfflineInspections(),
        getQueuedOperations(),
        getQueuedAssessmentOperations(),
        getQueuedTrainingOperations(),
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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLocalData();
  }, []);

  const syncTrainingToDatabase = async (training: any) => {
    setSyncing(training.id);
    try {
      // Prepare training data for insert
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
        synced_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("trainings").upsert(trainingData);

      if (error) throw error;

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
        synced_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("daily_assessments").upsert(assessmentData);

      if (error) throw error;

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
        synced_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("inspections").upsert(inspectionData);

      if (error) throw error;

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

  if (loading && !localData) {
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
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-5 w-5" />
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
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Database className="h-4 w-4" />
                Trainings
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold">{localData?.trainings.length || 0}</span>
                {unsyncedTrainings.length > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {unsyncedTrainings.length} unsynced
                  </Badge>
                )}
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Database className="h-4 w-4" />
                Daily Assessments
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold">{localData?.dailyAssessments.length || 0}</span>
                {unsyncedAssessments.length > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {unsyncedAssessments.length} unsynced
                  </Badge>
                )}
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Database className="h-4 w-4" />
                Inspections
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold">{localData?.inspections.length || 0}</span>
                {unsyncedInspections.length > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {unsyncedInspections.length} unsynced
                  </Badge>
                )}
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Clock className="h-4 w-4" />
                Queued Operations
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold">{totalQueued}</span>
                {totalQueued > 0 && (
                  <Badge variant="secondary" className="text-xs">
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
          <LocalSnapshotsPanel />
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
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => setDeleteConfirm({ type: "training", id: training.id })}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
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
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => setDeleteConfirm({ type: "dailyAssessment", id: assessment.id })}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
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
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => setDeleteConfirm({ type: "inspection", id: inspection.id })}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
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
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Queued Operations
              </CardTitle>
              <CardDescription>
                Pending operations waiting to be synced. These will be processed automatically when online.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Inspection Operations */}
                <div>
                  <h4 className="font-medium mb-2">Inspection Operations ({localData?.queuedOperations.length || 0})</h4>
                  {localData?.queuedOperations.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No pending inspection operations</div>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Type</TableHead>
                            <TableHead>Inspection ID</TableHead>
                            <TableHead>Timestamp</TableHead>
                            <TableHead>Retries</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {localData?.queuedOperations.map((op, idx) => (
                            <TableRow key={idx}>
                              <TableCell>
                                <Badge variant="outline">{op.type}</Badge>
                              </TableCell>
                              <TableCell className="font-mono text-xs">{op.inspectionId}</TableCell>
                              <TableCell className="text-sm">
                                {formatDate(new Date(op.timestamp).toISOString())}
                              </TableCell>
                              <TableCell>{op.retries}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {/* Assessment Operations */}
                <div>
                  <h4 className="font-medium mb-2">Assessment Operations ({localData?.queuedAssessmentOperations.length || 0})</h4>
                  {localData?.queuedAssessmentOperations.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No pending assessment operations</div>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Type</TableHead>
                            <TableHead>Assessment ID</TableHead>
                            <TableHead>Timestamp</TableHead>
                            <TableHead>Retries</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {localData?.queuedAssessmentOperations.map((op, idx) => (
                            <TableRow key={idx}>
                              <TableCell>
                                <Badge variant="outline">{op.type}</Badge>
                              </TableCell>
                              <TableCell className="font-mono text-xs">{op.assessmentId}</TableCell>
                              <TableCell className="text-sm">
                                {formatDate(new Date(op.timestamp).toISOString())}
                              </TableCell>
                              <TableCell>{op.retries}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {/* Training Operations */}
                <div>
                  <h4 className="font-medium mb-2">Training Operations ({localData?.queuedTrainingOperations.length || 0})</h4>
                  {localData?.queuedTrainingOperations.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No pending training operations</div>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Type</TableHead>
                            <TableHead>Training ID</TableHead>
                            <TableHead>Timestamp</TableHead>
                            <TableHead>Retries</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {localData?.queuedTrainingOperations.map((op, idx) => (
                            <TableRow key={idx}>
                              <TableCell>
                                <Badge variant="outline">{op.type}</Badge>
                              </TableCell>
                              <TableCell className="font-mono text-xs">{op.trainingId}</TableCell>
                              <TableCell className="text-sm">
                                {formatDate(new Date(op.timestamp).toISOString())}
                              </TableCell>
                              <TableCell>{op.retries}</TableCell>
                            </TableRow>
                          ))}
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

      {/* Delete Confirmation Dialog */}
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
    </div>
  );
}
