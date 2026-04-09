import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Trash2, RotateCcw, Clock, AlertTriangle, FileText, GraduationCap, ClipboardCheck, Loader2, Calendar, User, X, CloudOff } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { format } from "date-fns";
import { useSoftDelete, DeletedRecord, SoftDeleteTable } from "@/hooks/useSoftDelete";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getPendingSoftDeleteCount } from "@/lib/queued-soft-delete-processor";

export function DeletedRecordsRecovery() {
  const [deletedRecords, setDeletedRecords] = useState<DeletedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDialog, setConfirmDialog] = useState<{ 
    type: 'restore' | 'permanent-delete' | 'cleanup' | 'batch-delete'; 
    record?: DeletedRecord;
  } | null>(null);
  const [cleanupResult, setCleanupResult] = useState<{
    inspections: number;
    trainings: number;
    daily_assessments: number;
  } | null>(null);
  const [pendingDeleteCount, setPendingDeleteCount] = useState(0);

  const { getDeletedRecords, restoreRecord, permanentDelete, batchPermanentDelete, runCleanup, getRetentionBadge } = useSoftDelete();

  const makeKey = (r: DeletedRecord) => `${r.table_name}-${r.record_id}`;

  const toggleSelect = (record: DeletedRecord) => {
    const key = makeKey(record);
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSelectAll = (records: DeletedRecord[]) => {
    const keys = records.map(makeKey);
    const allSelected = keys.length > 0 && keys.every(k => selectedIds.has(k));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        keys.forEach(k => next.delete(k));
      } else {
        keys.forEach(k => next.add(k));
      }
      return next;
    });
  };

  const handleBatchDelete = async () => {
    const entries = deletedRecords
      .filter(r => selectedIds.has(makeKey(r)))
      .map(r => ({ table: r.table_name as SoftDeleteTable, recordId: r.record_id }));

    if (entries.length === 0) return;

    setActionLoading('batch-delete');
    try {
      const { succeeded, failed } = await batchPermanentDelete(entries);
      if (failed > 0) {
        toast.error(`Deleted ${succeeded} records, ${failed} failed`);
      } else {
        toast.success(`Permanently deleted ${succeeded} records`);
      }
      setSelectedIds(new Set());
      await loadDeletedRecords();
    } catch (error: any) {
      toast.error(error.message || "Batch delete failed");
    } finally {
      setActionLoading(null);
      setConfirmDialog(null);
    }
  };

  const loadDeletedRecords = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await getDeletedRecords();
      if (error) {
        toast.error(error);
        return;
      }
      setDeletedRecords(data || []);
    } catch (error: any) {
      console.error("[DeletedRecordsRecovery] Error loading records:", error);
      toast.error("Failed to load deleted records");
    } finally {
      setLoading(false);
    }
  }, [getDeletedRecords]);

  useEffect(() => {
    loadDeletedRecords();
    // Check for pending offline soft-deletes
    getPendingSoftDeleteCount().then(count => setPendingDeleteCount(count)).catch(() => {});
  }, [loadDeletedRecords]);

  const handleRestore = async () => {
    if (!confirmDialog?.record) return;
    const { record } = confirmDialog;
    
    setActionLoading(record.record_id);
    try {
      const { success, error, restoredRow } = await restoreRecord(
        record.table_name as SoftDeleteTable, 
        record.record_id
      );
      
      if (!success) {
        toast.error(error || "Failed to restore record");
        return;
      }
      
      // Persist restore marker so Dashboard can hydrate immediately
      try {
        const marker = {
          table: record.table_name,
          recordId: record.record_id,
          row: restoredRow || null,
          ts: Date.now(),
        };
        sessionStorage.setItem('restored-report-marker', JSON.stringify(marker));
      } catch {}
      
      toast.success("Record restored successfully");
      window.dispatchEvent(new CustomEvent('dashboard-stale'));
      await loadDeletedRecords();
    } catch (error: any) {
      console.error("[DeletedRecordsRecovery] Restore failed:", error);
      toast.error(error.message || "Failed to restore record");
    } finally {
      setActionLoading(null);
      setConfirmDialog(null);
    }
  };

  const handlePermanentDelete = async () => {
    if (!confirmDialog?.record) return;
    const { record } = confirmDialog;
    
    setActionLoading(record.record_id);
    try {
      const { success, error } = await permanentDelete(
        record.table_name as SoftDeleteTable, 
        record.record_id
      );
      
      if (!success) {
        toast.error(error || "Failed to permanently delete record");
        return;
      }
      
      toast.success("Record permanently deleted");
      await loadDeletedRecords();
    } catch (error: any) {
      console.error("[DeletedRecordsRecovery] Permanent delete failed:", error);
      toast.error(error.message || "Failed to delete record");
    } finally {
      setActionLoading(null);
      setConfirmDialog(null);
    }
  };

  const handleCleanup = async () => {
    setActionLoading('cleanup');
    try {
      const { success, counts, error } = await runCleanup();
      
      if (!success) {
        toast.error(error || "Cleanup failed");
        return;
      }
      
      setCleanupResult(counts || null);
      const total = (counts?.inspections || 0) + (counts?.trainings || 0) + (counts?.daily_assessments || 0);
      
      if (total > 0) {
        toast.success(`Cleaned up ${total} expired records`);
      } else {
        toast.info("No expired records to clean up");
      }
      
      await loadDeletedRecords();
    } catch (error: any) {
      console.error("[DeletedRecordsRecovery] Cleanup failed:", error);
      toast.error(error.message || "Cleanup failed");
    } finally {
      setActionLoading(null);
      setConfirmDialog(null);
    }
  };

  const getTableIcon = (tableName: string) => {
    switch (tableName) {
      case 'inspections':
        return <FileText className="h-4 w-4" />;
      case 'trainings':
        return <GraduationCap className="h-4 w-4" />;
      case 'daily_assessments':
        return <ClipboardCheck className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const getTableLabel = (tableName: string) => {
    switch (tableName) {
      case 'inspections':
        return 'Inspection';
      case 'trainings':
        return 'Training';
      case 'daily_assessments':
        return 'Daily Assessment';
      default:
        return tableName;
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    try {
      return format(new Date(dateStr), "MMM d, yyyy h:mm a");
    } catch {
      return dateStr;
    }
  };

  // Group records by table
  const inspections = deletedRecords.filter(r => r.table_name === 'inspections');
  const trainings = deletedRecords.filter(r => r.table_name === 'trainings');
  const dailyAssessments = deletedRecords.filter(r => r.table_name === 'daily_assessments');
  const expiredCount = deletedRecords.filter(r => r.days_remaining <= 0).length;

  if (loading && deletedRecords.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading deleted records...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5" />
                Deleted Records Recovery
              </CardTitle>
              <CardDescription className="mt-2">
                View and restore soft-deleted records. Records are automatically removed after 60 days.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={loadDeletedRecords} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              {expiredCount > 0 && (
                <Button 
                  variant="destructive" 
                  onClick={() => setConfirmDialog({ type: 'cleanup' })}
                  disabled={actionLoading === 'cleanup'}
                >
                  {actionLoading === 'cleanup' ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  Cleanup Expired ({expiredCount})
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <FileText className="h-4 w-4" />
                Deleted Inspections
              </div>
              <div className="mt-2 text-2xl font-bold">{inspections.length}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <GraduationCap className="h-4 w-4" />
                Deleted Trainings
              </div>
              <div className="mt-2 text-2xl font-bold">{trainings.length}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ClipboardCheck className="h-4 w-4" />
                Deleted Assessments
              </div>
              <div className="mt-2 text-2xl font-bold">{dailyAssessments.length}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Expired (Ready to Purge)
              </div>
              <div className="mt-2 text-2xl font-bold text-destructive">{expiredCount}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {pendingDeleteCount > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 py-4">
            <CloudOff className="h-5 w-5 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-400">
              <strong>{pendingDeleteCount}</strong> deletion{pendingDeleteCount !== 1 ? 's are' : ' is'} pending sync.
              They will appear here once the device reconnects and syncs.
            </p>
          </CardContent>
        </Card>
      )}

      {deletedRecords.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <RotateCcw className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No Deleted Records</h3>
            <p className="text-sm text-muted-foreground mt-2">
              When users delete reports, they'll appear here for 60 days before permanent removal.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="all" className="space-y-4">
          <TabsList>
            <TabsTrigger value="all">All ({deletedRecords.length})</TabsTrigger>
            <TabsTrigger value="inspections">Inspections ({inspections.length})</TabsTrigger>
            <TabsTrigger value="trainings">Trainings ({trainings.length})</TabsTrigger>
            <TabsTrigger value="assessments">Assessments ({dailyAssessments.length})</TabsTrigger>
          </TabsList>

          {['all', 'inspections', 'trainings', 'assessments'].map((tabValue) => {
            let records: DeletedRecord[];
            switch (tabValue) {
              case 'inspections':
                records = inspections;
                break;
              case 'trainings':
                records = trainings;
                break;
              case 'assessments':
                records = dailyAssessments;
                break;
              default:
                records = deletedRecords;
            }

            const tabKeys = records.map(makeKey);
            const allSelected = tabKeys.length > 0 && tabKeys.every(k => selectedIds.has(k));
            const someSelected = tabKeys.some(k => selectedIds.has(k));

            return (
              <TabsContent key={tabValue} value={tabValue}>
                <Card>
                  <CardContent className="pt-6">
                    {selectedIds.size > 0 && (
                      <div className="flex items-center gap-3 mb-4 p-3 rounded-lg border bg-muted/50">
                        <span className="text-sm font-medium">{selectedIds.size} selected</span>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setConfirmDialog({ type: 'batch-delete' })}
                          disabled={actionLoading === 'batch-delete'}
                        >
                          {actionLoading === 'batch-delete' ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 mr-2" />
                          )}
                          Delete Selected
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedIds(new Set())}
                        >
                          <X className="h-4 w-4 mr-1" />
                          Clear
                        </Button>
                      </div>
                    )}
                    {records.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        No deleted records in this category
                      </div>
                    ) : (
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10">
                                <Checkbox
                                  checked={allSelected}
                                  onCheckedChange={() => toggleSelectAll(records)}
                                  aria-label="Select all"
                                />
                              </TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Organization</TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead>Deleted</TableHead>
                              <TableHead>Deleted By</TableHead>
                              <TableHead>Retention</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {records.map((record) => {
                              const badge = getRetentionBadge(record.days_remaining);
                              const isExpired = record.days_remaining <= 0;
                              const key = makeKey(record);
                              
                              return (
                                <TableRow key={key} data-state={selectedIds.has(key) ? "selected" : undefined}>
                                  <TableCell>
                                    <Checkbox
                                      checked={selectedIds.has(key)}
                                      onCheckedChange={() => toggleSelect(record)}
                                      aria-label={`Select ${record.organization}`}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      {getTableIcon(record.table_name)}
                                      <span className="text-sm">{getTableLabel(record.table_name)}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="font-medium">
                                    {record.organization || "N/A"}
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    <div className="flex items-center gap-1">
                                      <Calendar className="h-3 w-3 text-muted-foreground" />
                                      {record.record_date}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">
                                    {formatDate(record.deleted_at)}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-1">
                                      <User className="h-3 w-3 text-muted-foreground" />
                                      <span className="text-sm">{record.deleter_name}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <Badge 
                                          variant={badge.variant}
                                          className="flex items-center gap-1 w-fit"
                                        >
                                          <Clock className="h-3 w-3" />
                                          {isExpired ? 'Expired' : badge.label}
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {isExpired 
                                          ? 'This record can be permanently deleted'
                                          : `Will be permanently deleted on ${format(new Date(record.retention_until), 'PP')}`
                                        }
                                      </TooltipContent>
                                    </Tooltip>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex justify-end gap-2">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => setConfirmDialog({ type: 'restore', record })}
                                            disabled={actionLoading === record.record_id}
                                          >
                                            {actionLoading === record.record_id ? (
                                              <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                              <RotateCcw className="h-4 w-4" />
                                            )}
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Restore this record</TooltipContent>
                                      </Tooltip>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => setConfirmDialog({ type: 'permanent-delete', record })}
                                            disabled={actionLoading === record.record_id}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Permanently delete</TooltipContent>
                                      </Tooltip>
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
            );
          })}
        </Tabs>
      )}

      {/* Restore Confirmation Dialog */}
      <AlertDialog 
        open={confirmDialog?.type === 'restore'} 
        onOpenChange={() => setConfirmDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore Record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will restore the {confirmDialog?.record && getTableLabel(confirmDialog.record.table_name).toLowerCase()} 
              {' '}for "{confirmDialog?.record?.organization}" and make it visible to users again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestore}>
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Permanent Delete Confirmation Dialog */}
      <AlertDialog 
        open={confirmDialog?.type === 'permanent-delete'} 
        onOpenChange={() => setConfirmDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Permanently Delete?</AlertDialogTitle>
            <AlertDialogDescription>
              This will <strong>permanently delete</strong> the {confirmDialog?.record && getTableLabel(confirmDialog.record.table_name).toLowerCase()} 
              {' '}for "{confirmDialog?.record?.organization}" and all associated data.
              <br /><br />
              <strong className="text-destructive">This action cannot be undone.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handlePermanentDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Permanently Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch Delete Confirmation Dialog */}
      <AlertDialog 
        open={confirmDialog?.type === 'batch-delete'} 
        onOpenChange={() => setConfirmDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Permanently Delete {selectedIds.size} Records?</AlertDialogTitle>
            <AlertDialogDescription>
              This will <strong>permanently delete {selectedIds.size} selected records</strong> and all their associated data.
              <br /><br />
              <strong className="text-destructive">This action cannot be undone.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleBatchDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete {selectedIds.size} Records
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog 
        open={confirmDialog?.type === 'cleanup'} 
        onOpenChange={() => setConfirmDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Run Cleanup?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {expiredCount} expired records that have passed their 60-day retention period.
              <br /><br />
              <strong className="text-destructive">This action cannot be undone.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleCleanup}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Run Cleanup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cleanup Result */}
      {cleanupResult && (
        <Card className="border-green-500/50 bg-green-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-green-600 mb-2">
              <RotateCcw className="h-5 w-5" />
              <span className="font-medium">Cleanup Complete</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Permanently deleted: {cleanupResult.inspections} inspections, {cleanupResult.trainings} trainings, {cleanupResult.daily_assessments} daily assessments
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
