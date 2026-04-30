import { useState, useEffect, useCallback, useRef, Component, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Upload, Trash2, AlertTriangle, Database, HardDrive, CheckCircle2, XCircle, Clock, Loader2, Download, RotateCcw, Shield, Cloud, Search, X, Eye } from "lucide-react";
import { SnapshotPreviewDialog } from "./SnapshotPreviewDialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { listAllSnapshots, getReportSnapshot, deleteReportSnapshot, getBackupStorageInfo, importReportBackup, sanitizeFilename, type ReportType, type ReportSnapshot } from "@/lib/local-backup-ledger";
import { withRestoreLock } from "@/lib/restore-lock";
import { verifyRestoreIntegrity } from "@/lib/restore-integrity";
import { fetchAdminEditSnapshots, restoreAdminEditSnapshot, type AdminEditSnapshotEntry } from "@/lib/admin-edit-snapshot";
import { formatReportFilename } from "@/lib/report-naming";
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
  saveRelatedDataOffline,
  saveAssessmentDataOffline,
  saveTrainingDataOffline,
  type DbRow,
} from "@/lib/offline-storage";
import type { CloudBackupEntry, AllUserCloudSnapshot } from "@/lib/cloud-backup";

// ── Local helper types ────────────────────────────────────────────
//
// Derived from the source helpers' signatures so renames flow through to
// this file automatically. Kept here (rather than re-exported from the
// helpers) to keep the helper modules' public surface intentional.

type SnapshotMeta = ReturnType<typeof listAllSnapshots>[number];
type QueuedInspectionOp = Awaited<ReturnType<typeof getQueuedOperations>>[number];
type QueuedAssessmentOp = Awaited<ReturnType<typeof getQueuedAssessmentOperations>>[number];
type QueuedTrainingOp = Awaited<ReturnType<typeof getQueuedTrainingOperations>>[number];
type QueuedOp = QueuedInspectionOp | QueuedAssessmentOp | QueuedTrainingOp;

type RelatedDataKey = Parameters<typeof saveRelatedDataOffline>[0];
type AssessmentDataKey = Parameters<typeof saveAssessmentDataOffline>[0];
type TrainingDataKey = Parameters<typeof saveTrainingDataOffline>[0];

// `formatReportFilename` accepts the dash-form ('daily-assessment') while
// the rest of the app uses the underscore-form ('daily_assessment'). The
// function body ignores `reportType` today but keep the argument type
// honest so callers don't widen back to `any`.
type FilenameReportType = 'inspection' | 'training' | 'daily-assessment';
function toFilenameReportType(t: string | undefined | null): FilenameReportType {
  if (t === 'training') return 'training';
  if (t === 'daily_assessment' || t === 'daily-assessment') return 'daily-assessment';
  return 'inspection';
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return fallback;
}

// verifyRestoreIntegrity moved to @/lib/restore-integrity (shared with importBackupZip).
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

// ── Reusable search bar for recovery panels ─────────────────────
function RecoverySearchBar({ value, onChange, placeholder = "Search by facility or user..." }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => onChange(local), 300);
    return () => clearTimeout(t);
  }, [local, onChange]);

  useEffect(() => {
    if (value !== local) setLocal(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative mb-3">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        className="pl-9 pr-9 h-9 text-sm bg-white/5 dark:bg-white/[0.03] border-white/10"
      />
      {local && (
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/10 text-muted-foreground"
          onClick={() => { setLocal(''); onChange(''); }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

interface LocalData {
  trainings: DbRow[];
  dailyAssessments: DbRow[];
  inspections: DbRow[];
  queuedOperations: QueuedInspectionOp[];
  queuedAssessmentOperations: QueuedAssessmentOp[];
  queuedTrainingOperations: QueuedTrainingOp[];
}

interface DataRecoveryToolProps {
  deletedRecordsSlot?: React.ReactNode;
}

export function DataRecoveryTool({ deletedRecordsSlot }: DataRecoveryToolProps) {
  return (
    <Tabs defaultValue="local" className="w-full">
      <TabsList className="w-full flex overflow-x-auto backdrop-blur-md bg-white/5 dark:bg-white/[0.03] border border-white/10 rounded-lg h-auto p-1 gap-1">
        <TabsTrigger value="local" className="text-xs md:text-sm whitespace-nowrap flex-shrink-0">Local</TabsTrigger>
        <TabsTrigger value="cloud" className="text-xs md:text-sm whitespace-nowrap flex-shrink-0">Cloud</TabsTrigger>
        <TabsTrigger value="all-users" className="text-xs md:text-sm whitespace-nowrap flex-shrink-0">All Users</TabsTrigger>
        <TabsTrigger value="edit-history" className="text-xs md:text-sm whitespace-nowrap flex-shrink-0">Edits</TabsTrigger>
        <TabsTrigger value="indexeddb" className="text-xs md:text-sm whitespace-nowrap flex-shrink-0">IndexedDB</TabsTrigger>
        {deletedRecordsSlot && (
          <TabsTrigger value="deleted" className="text-xs md:text-sm whitespace-nowrap flex-shrink-0">Deleted</TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="local">
        <RecoveryErrorBoundary panelName="Local Backup Snapshots">
          <LocalSnapshotsPanel />
        </RecoveryErrorBoundary>
      </TabsContent>

      <TabsContent value="cloud">
        <RecoveryErrorBoundary panelName="Cloud Backup Snapshots">
          <CloudSnapshotsPanel />
        </RecoveryErrorBoundary>
      </TabsContent>

      <TabsContent value="all-users">
        <RecoveryErrorBoundary panelName="All User Snapshots">
          <AllUserSnapshotsPanel />
        </RecoveryErrorBoundary>
      </TabsContent>

      <TabsContent value="edit-history">
        <RecoveryErrorBoundary panelName="Admin Edit History">
          <AdminEditHistoryPanel />
        </RecoveryErrorBoundary>
      </TabsContent>

      <TabsContent value="indexeddb">
        <RecoveryErrorBoundary panelName="IndexedDB Recovery">
          <IndexedDBRecoveryPanel />
        </RecoveryErrorBoundary>
      </TabsContent>

      {deletedRecordsSlot && (
        <TabsContent value="deleted">
          <RecoveryErrorBoundary panelName="Deleted Records Recovery">
            {deletedRecordsSlot}
          </RecoveryErrorBoundary>
        </TabsContent>
      )}
    </Tabs>
  );
}

interface SnapshotsPanelProps {
  allowDelete?: boolean;
}

export function LocalSnapshotsPanel({ allowDelete = true }: SnapshotsPanelProps) {
  const [snapshots, setSnapshots] = useState(() => listAllSnapshots());
  const [storageInfo, setStorageInfo] = useState(() => getBackupStorageInfo());
  const [importing, setImporting] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [previewState, setPreviewState] = useState<{
    open: boolean;
    snapshot: ReportSnapshot | null;
    reportType?: ReportType;
    reportId?: string;
    meta?: {
      snapshotId: string;
      device: string;
      timestamp: number;
      synced: boolean;
      sizeBytes: number;
      source: 'local';
    };
  }>({ open: false, snapshot: null });

  const refreshSnapshots = useCallback(() => {
    setSnapshots(listAllSnapshots());
    setStorageInfo(getBackupStorageInfo());
  }, []);

  const handlePreview = useCallback((s: SnapshotMeta) => {
    const snap = getReportSnapshot(s.reportType, s.reportId);
    setPreviewState({
      open: true,
      snapshot: snap,
      reportType: s.reportType,
      reportId: s.reportId,
      meta: {
        snapshotId: s.reportId,
        device: s.device,
        timestamp: s.timestamp,
        synced: s.synced,
        sizeBytes: s.sizeBytes,
        source: 'local' as const,
      },
    });
  }, []);

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected
    e.target.value = '';
    setImporting(true);
    try {
      const { reportType, reportId, photoCount } = await importReportBackup(file);
      refreshSnapshots();
      setHighlightedId(reportId);
      setTimeout(() => setHighlightedId(null), 8600);
      const photoPart = photoCount ? ` with ${photoCount} photo${photoCount > 1 ? 's' : ''}` : '';
      toast.success(`Imported ${reportType.replace('_', ' ')} backup${photoPart}`, {
        description: `Report ${reportId.substring(0, 8)}… restored to local + cloud storage.`,
      });
    } catch (err) {
      toast.error('Import failed', { description: errorMessage(err, 'Unknown error') });
    } finally {
      setImporting(false);
    }
  }, [refreshSnapshots]);

  const handleExport = (reportType: ReportType, reportId: string) => {
    const snapshot = getReportSnapshot(reportType, reportId);
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const org = snapshot.parent?.organization;
    a.download = formatReportFilename((org as string | undefined) || undefined, toFilenameReportType(reportType), 'json');
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Snapshot exported as JSON");
  };

  const handleRestore = async (reportType: ReportType, reportId: string) => {
    const snapshot = getReportSnapshot(reportType, reportId);
    if (!snapshot) return;
    // H2: Hold the restore lock so auto-sync cannot interleave a T0-snapshot
    // overwrite over the freshly-restored rows. Lock is released on completion
    // (success or failure); useAutoSync triggers a fresh sync on release.
    await withRestoreLock(async () => {
      try {
        const offline = await import('@/lib/offline-storage');
        const { saveInspectionOffline, saveRelatedDataOffline, saveTrainingOffline, saveTrainingDataOffline, saveDailyAssessmentOffline, saveAssessmentDataOffline } = offline;

        const parentArg = snapshot.parent as Record<string, unknown> & { id: string };
        if (reportType === 'inspection') {
          await saveInspectionOffline(parentArg);
          for (const [key, data] of Object.entries(snapshot.children)) {
            if (Array.isArray(data) && data.length > 0) {
              await saveRelatedDataOffline(key as RelatedDataKey, reportId, data as Record<string, unknown>[]);
            }
          }
        } else if (reportType === 'training') {
          await saveTrainingOffline(parentArg);
          for (const [key, data] of Object.entries(snapshot.children)) {
            if (Array.isArray(data) && data.length > 0) {
              await saveTrainingDataOffline(key as TrainingDataKey, reportId, data as Record<string, unknown>[]);
            }
          }
        } else if (reportType === 'daily_assessment') {
          await saveDailyAssessmentOffline(parentArg);
          for (const [key, data] of Object.entries(snapshot.children)) {
            if (Array.isArray(data) && data.length > 0) {
              await saveAssessmentDataOffline(key as AssessmentDataKey, reportId, data as Record<string, unknown>[]);
            }
          }
        }

        // H2 + N-B: Post-restore integrity check. Re-read the parent AND each
        // restored child array; if a concurrent sync stripped a child row the
        // verifier re-applies. N-C: verifier now throws on read failure so we
        // surface to the user rather than silently claim success.
        try {
          await verifyRestoreIntegrity(
            reportType,
            reportId,
            snapshot.parent,
            async () => {
              if (reportType === 'inspection') {
                await saveInspectionOffline(parentArg);
                for (const [key, data] of Object.entries(snapshot.children)) {
                  if (Array.isArray(data) && data.length > 0) await saveRelatedDataOffline(key as RelatedDataKey, reportId, data as Record<string, unknown>[]);
                }
              } else if (reportType === 'training') {
                await saveTrainingOffline(parentArg);
                for (const [key, data] of Object.entries(snapshot.children)) {
                  if (Array.isArray(data) && data.length > 0) await saveTrainingDataOffline(key as TrainingDataKey, reportId, data as Record<string, unknown>[]);
                }
              } else if (reportType === 'daily_assessment') {
                await saveDailyAssessmentOffline(parentArg);
                for (const [key, data] of Object.entries(snapshot.children)) {
                  if (Array.isArray(data) && data.length > 0) await saveAssessmentDataOffline(key as AssessmentDataKey, reportId, data as Record<string, unknown>[]);
                }
              }
            },
            { expectedChildren: snapshot.children },
          );
          toast.success("Snapshot restored to local storage");
        } catch (verifyErr) {
          console.error('[Recovery] Restore verification failed', verifyErr);
          toast.error(
            'Restore finished but verification failed. Please refresh and confirm the report looks correct.'
          );
        }
      } catch (error) {
        console.error('[Data Recovery] Restore failed:', error);
        toast.error("Failed to restore snapshot");
      }
    });
  };

  const handleDelete = (reportType: ReportType, reportId: string) => {
    deleteReportSnapshot(reportType, reportId);
    refreshSnapshots();
    toast.success("Snapshot deleted");
  };

  const formatDate = (ts: number) => {
    try { return format(new Date(ts), "MMM d, yyyy h:mm a"); } catch { return "N/A"; }
  };

  const filteredSnapshots = snapshots.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (s.organization || '').toLowerCase().includes(q)
        || s.reportType.replace('_', ' ').toLowerCase().includes(q)
        || s.device.toLowerCase().includes(q)
        || s.reportId.toLowerCase().includes(q);
  });

  return (
    <>
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
          <div className="flex gap-2 shrink-0">
            <input type="file" accept=".json,.zip" className="hidden" id="import-backup-file" onChange={handleImportFile} />
            <Button variant="outline" size="sm" disabled={importing} onClick={() => document.getElementById('import-backup-file')?.click()} title="Import a previously exported backup JSON file">
              {importing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Import
            </Button>
            {snapshots.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => {
                const allData = snapshots.map(s => ({ ...s, snapshotData: getReportSnapshot(s.reportType, s.reportId) }));
                const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `local-backups-${new Date().toISOString().split('T')[0]}.json`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success("All local snapshots downloaded");
              }} title="Download all snapshots to device">
                <HardDrive className="h-4 w-4 mr-2" />
                Save All
              </Button>
            )}
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
            <RecoverySearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search by organization, type, device, or ID..." />
            {filteredSnapshots.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No snapshots match &ldquo;{searchQuery}&rdquo;.
              </div>
            ) : (
              <>
                {/* Mobile card layout */}
                <div className="md:hidden space-y-3">
                  {filteredSnapshots.map((s) => (
                    <div key={s.key} className={`rounded-lg border border-white/10 bg-white/5 dark:bg-white/[0.02] p-3 space-y-2.5 min-w-0 overflow-hidden font-mono ${s.reportId === highlightedId ? 'import-flash' : ''}`}>
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
                        <Button size="sm" variant="outline" onClick={() => handlePreview(s)} title="Preview snapshot">
                          <Eye className="h-4 w-4" />
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
                      {filteredSnapshots.map((s) => (
                        <TableRow key={s.key} className={s.reportId === highlightedId ? 'import-flash' : ''}>
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
                              <Button size="sm" variant="outline" onClick={() => handlePreview(s)} title="Preview snapshot contents">
                                <Eye className="h-4 w-4" />
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
          </>
        )}
      </CardContent>
    </Card>
    <SnapshotPreviewDialog
      open={previewState.open}
      onOpenChange={(open) => setPreviewState((p) => ({ ...p, open }))}
      snapshotData={previewState.snapshot}
      reportType={previewState.reportType}
      meta={previewState.meta}
      onRestore={previewState.reportType && previewState.reportId
        ? async () => {
            await handleRestore(previewState.reportType!, previewState.reportId!);
          }
        : undefined}
      onExport={previewState.reportType && previewState.reportId
        ? () => handleExport(previewState.reportType!, previewState.reportId!)
        : undefined}
    />
    </>
  );
}

interface CloudSnapshotsPanelProps {
  allowDelete?: boolean;
}

export function CloudSnapshotsPanel({ allowDelete = true }: CloudSnapshotsPanelProps) {
  const [snapshots, setSnapshots] = useState<CloudBackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const lastFetchedAt = useRef<number>(0);
  const STALE_TIME = 30000;
  const [searchQuery, setSearchQuery] = useState('');
  type CloudSnapshotData = {
    parent: Record<string, unknown>;
    children: Record<string, Record<string, unknown>[]>;
  };
  const [previewState, setPreviewState] = useState<{ open: boolean; snapshot: CloudSnapshotData | null; loading: boolean; row: CloudBackupEntry | null }>({ open: false, snapshot: null, loading: false, row: null });
  const previewCache = useRef<Map<string, CloudSnapshotData>>(new Map());

  const handlePreview = useCallback(async (s: CloudBackupEntry) => {
    if (previewCache.current.has(s.id)) {
      setPreviewState({ open: true, snapshot: previewCache.current.get(s.id), loading: false, row: s });
      return;
    }
    setPreviewState({ open: true, snapshot: null, loading: true, row: s });
    try {
      const { fetchCloudSnapshot } = await import('@/lib/cloud-backup');
      const full = await fetchCloudSnapshot(s.id);
      const data: CloudSnapshotData | null = full?.snapshot_data
        ? { parent: full.snapshot_data.parent, children: full.snapshot_data.children }
        : null;
      if (data) previewCache.current.set(s.id, data);
      setPreviewState({ open: true, snapshot: data, loading: false, row: s });
    } catch (e) {
      toast.error("Failed to load snapshot preview");
      setPreviewState({ open: false, snapshot: null, loading: false, row: null });
    }
  }, []);

  const handlePreviewExport = useCallback(() => {
    const row = previewState.row;
    const data = previewState.snapshot;
    if (!row || !data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const org = data?.parent?.organization || row.facility || 'snapshot';
    a.download = formatReportFilename(org, toFilenameReportType(row.report_type), 'json');
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Snapshot exported as JSON");
  }, [previewState]);

  const loadSnapshots = useCallback(async (force = false) => {
    // Skip if data is fresh (stale-while-revalidate)
    if (!force && Date.now() - lastFetchedAt.current < STALE_TIME && snapshots.length > 0) {
      return;
    }
    setLoading(true);
    try {
      const result = await Promise.race([
        (async () => {
          const { fetchCloudSnapshots } = await import('@/lib/cloud-backup');
          return await fetchCloudSnapshots();
        })(),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 15000)),
      ]);
      if (result === 'timeout') {
        toast.error("Loading cloud backups timed out");
      } else {
        setSnapshots(result);
        lastFetchedAt.current = Date.now();
      }
    } catch {
      toast.error("Failed to load cloud backups");
    } finally {
      setLoading(false);
    }
  }, [snapshots.length]);

  useEffect(() => {
    loadSnapshots();
  }, []);

  const handleRestore = async (snapshotId: string) => {
    // H2: Hold the restore lock so auto-sync cannot interleave a T0-snapshot
    // overwrite over the freshly-restored rows. Lock is released on completion
    // (success or failure); useAutoSync triggers a fresh sync on release.
    await withRestoreLock(async () => {
      try {
        const { fetchCloudSnapshot } = await import('@/lib/cloud-backup');
        const full = await fetchCloudSnapshot(snapshotId);
        if (!full) { toast.error("Failed to fetch snapshot data"); return; }

        const offline = await import('@/lib/offline-storage');
        const { saveInspectionOffline, saveRelatedDataOffline, saveTrainingOffline, saveTrainingDataOffline, saveDailyAssessmentOffline, saveAssessmentDataOffline } = offline;
        const { parent, children } = full.snapshot_data;
        const parentArg = parent as Record<string, unknown> & { id: string };
        const reportType = full.report_type as ReportType;
        const reportId = full.report_id;

        if (reportType === 'inspection') {
          await saveInspectionOffline(parentArg);
          for (const [key, data] of Object.entries(children)) {
            if (Array.isArray(data) && data.length > 0) await saveRelatedDataOffline(key as RelatedDataKey, reportId, data as Record<string, unknown>[]);
          }
        } else if (reportType === 'training') {
          await saveTrainingOffline(parentArg);
          for (const [key, data] of Object.entries(children)) {
            if (Array.isArray(data) && data.length > 0) await saveTrainingDataOffline(key as TrainingDataKey, reportId, data as Record<string, unknown>[]);
          }
        } else if (reportType === 'daily_assessment') {
          await saveDailyAssessmentOffline(parentArg);
          for (const [key, data] of Object.entries(children)) {
            if (Array.isArray(data) && data.length > 0) await saveAssessmentDataOffline(key as AssessmentDataKey, reportId, data as Record<string, unknown>[]);
          }
        }

        // H2 + N-B: parent + child drift detection. N-C: surface verify failures.
        try {
          await verifyRestoreIntegrity(
            reportType,
            reportId,
            parentArg,
            async () => {
              if (reportType === 'inspection') {
                await saveInspectionOffline(parentArg);
                for (const [key, data] of Object.entries(children)) {
                  if (Array.isArray(data) && data.length > 0) await saveRelatedDataOffline(key as RelatedDataKey, reportId, data as Record<string, unknown>[]);
                }
              } else if (reportType === 'training') {
                await saveTrainingOffline(parentArg);
                for (const [key, data] of Object.entries(children)) {
                  if (Array.isArray(data) && data.length > 0) await saveTrainingDataOffline(key as TrainingDataKey, reportId, data as Record<string, unknown>[]);
                }
              } else if (reportType === 'daily_assessment') {
                await saveDailyAssessmentOffline(parentArg);
                for (const [key, data] of Object.entries(children)) {
                  if (Array.isArray(data) && data.length > 0) await saveAssessmentDataOffline(key as AssessmentDataKey, reportId, data as Record<string, unknown>[]);
                }
              }
            },
            { expectedChildren: children },
          );
          toast.success("Cloud backup restored to local storage");
        } catch (verifyErr) {
          console.error('[Cloud Recovery] Restore verification failed', verifyErr);
          toast.error('Cloud restore finished but verification failed. Please refresh and confirm the report looks correct.');
        }
      } catch (error) {
        console.error('[Cloud Recovery] Restore failed:', error);
        toast.error("Failed to restore cloud backup");
      }
    });
  };

  const handleDelete = async (snapshotId: string) => {
    try {
      const { deleteCloudSnapshot } = await import('@/lib/cloud-backup');
      const ok = await deleteCloudSnapshot(snapshotId);
      if (ok) {
        setSnapshots(prev => prev.filter(s => s.id !== snapshotId));
        toast.success("Cloud backup deleted");
      } else {
        toast.error("Failed to delete cloud backup");
      }
    } catch {
      toast.error("Failed to delete cloud backup");
    }
  };

  const formatDate = (ts: number) => {
    try { return format(new Date(ts), "MMM d, yyyy h:mm a"); } catch { return "N/A"; }
  };

  const filteredSnapshots = snapshots.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (s.facility || '').toLowerCase().includes(q)
        || (s.user_name || '').toLowerCase().includes(q)
        || (s.report_type || '').replace('_', ' ').toLowerCase().includes(q)
        || (s.device || '').toLowerCase().includes(q)
        || (s.report_id || '').toLowerCase().includes(q);
  });

  return (
    <>
    <Card className="backdrop-blur-md bg-white/5 dark:bg-white/[0.03] border border-white/10 rounded-xl shadow-lg shadow-black/5 overflow-hidden">
      <CardHeader className="px-3 md:px-6 py-4 md:p-6">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Cloud className="h-5 w-5 text-blue-400 shrink-0" />
              Cloud Backup Snapshots
            </CardTitle>
            <CardDescription className="mt-2 break-words" style={{ overflowWrap: 'anywhere' }}>
              Snapshots synced to the central database. Accessible from any device.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {snapshots.length > 0 && (
              <Button variant="outline" size="sm" onClick={async () => {
                try {
                  const { fetchCloudSnapshot } = await import('@/lib/cloud-backup');
                  const fullSnapshots = await Promise.all(
                    snapshots.map(async (s) => {
                      const full = await fetchCloudSnapshot(s.id);
                      return { ...s, snapshot_data: full?.snapshot_data };
                    })
                  );
                  const blob = new Blob([JSON.stringify(fullSnapshots, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `cloud-backups-${new Date().toISOString().split('T')[0]}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success("All cloud snapshots downloaded");
                } catch {
                  toast.error("Failed to download cloud snapshots");
                }
              }} title="Download all cloud snapshots to device">
                <HardDrive className="h-4 w-4 mr-2" />
                Save All
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => loadSnapshots(true)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 md:px-6 pb-4 md:pb-6 pt-0">
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading cloud backups...
          </div>
        ) : snapshots.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No cloud backups found. They are created automatically when you save reports while online.
          </div>
        ) : (
          <>
            <RecoverySearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search by facility, user, type, device, or ID..." />
            {filteredSnapshots.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No snapshots match &ldquo;{searchQuery}&rdquo;.
              </div>
            ) : (
            <>
            {/* Mobile card layout */}
            <div className="md:hidden space-y-3">
              {filteredSnapshots.map((s) => (
                <div key={s.id} className="rounded-lg border border-white/10 bg-white/5 dark:bg-white/[0.02] p-3 space-y-2.5 min-w-0 overflow-hidden font-mono">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">{(s.report_type || '').replace('_', ' ')}</Badge>
                    <Badge variant={s.synced ? "default" : "destructive"} className="text-xs">
                      {s.synced ? "Synced" : "Unsynced"}
                    </Badge>
                  </div>
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0">Facility</span>
                      <span className="text-right min-w-0 break-words" style={{ overflowWrap: 'anywhere' }}>{s.facility || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0">User</span>
                      <span className="text-right min-w-0 break-words" style={{ overflowWrap: 'anywhere' }}>{s.user_name || 'Unknown'}</span>
                    </div>
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0">Device</span>
                      <span className="text-right min-w-0 break-words" style={{ overflowWrap: 'anywhere' }}>{s.device}</span>
                    </div>
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0">Saved</span>
                      <span className="text-right text-muted-foreground break-words" style={{ overflowWrap: 'anywhere' }}>{formatDate(s.snapshot_ts)}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="flex-1 w-full" onClick={() => handleRestore(s.id)}>
                      <RotateCcw className="h-4 w-4 mr-1.5" />
                      Restore
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handlePreview(s)} title="Preview snapshot" disabled={previewState.loading && previewState.row?.id === s.id}>
                      {previewState.loading && previewState.row?.id === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    {allowDelete && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(s.id)} title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table layout */}
            <div className="hidden md:block rounded-lg border border-white/10 bg-white/5 dark:bg-white/[0.02] overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-white/5 dark:bg-white/[0.03] backdrop-blur-sm border-white/10 hover:bg-white/5">
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 py-2.5 px-3">Type</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 py-2.5 px-3">Facility</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 py-2.5 px-3">User</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 py-2.5 px-3">Device</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 py-2.5 px-3">Sync</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 py-2.5 px-3">Last Saved</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 py-2.5 px-3 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSnapshots.map((s) => (
                    <TableRow key={s.id} className="border-white/5 hover:bg-white/[0.03]">
                      <TableCell className="py-2.5 px-3">
                        <Badge variant="outline" className="text-xs font-mono">{(s.report_type || '').replace('_', ' ')}</Badge>
                      </TableCell>
                      <TableCell className="py-2.5 px-3 text-xs font-mono max-w-[180px] truncate" title={s.facility}>{s.facility || 'N/A'}</TableCell>
                      <TableCell className="py-2.5 px-3 text-xs font-mono">{s.user_name || 'Unknown'}</TableCell>
                      <TableCell className="py-2.5 px-3 text-xs font-mono">{s.device}</TableCell>
                      <TableCell className="py-2.5 px-3">
                        <Badge variant={s.synced ? "default" : "destructive"} className="text-xs">
                          {s.synced ? "Synced" : "Unsynced"}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2.5 px-3 text-xs text-muted-foreground font-mono">{formatDate(s.snapshot_ts)}</TableCell>
                      <TableCell className="py-2.5 px-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => handleRestore(s.id)} title="Restore to IndexedDB">
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handlePreview(s)} title="Preview snapshot contents" disabled={previewState.loading && previewState.row?.id === s.id}>
                            {previewState.loading && previewState.row?.id === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          {allowDelete && (
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(s.id)} title="Delete cloud backup">
                              <Trash2 className="h-4 w-4" />
                            </Button>
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
          </>
        )}
      </CardContent>
    </Card>
    <SnapshotPreviewDialog
      open={previewState.open}
      onOpenChange={(open) => setPreviewState((p) => ({ ...p, open }))}
      snapshotData={previewState.snapshot}
      reportType={previewState.row?.report_type}
      loading={previewState.loading}
      meta={previewState.row ? {
        snapshotId: previewState.row.id,
        device: previewState.row.device,
        timestamp: previewState.row.snapshot_ts,
        synced: previewState.row.synced,
        userName: previewState.row.user_name,
        source: 'cloud' as const,
      } : undefined}
      onRestore={previewState.row ? async () => { await handleRestore(previewState.row.id); } : undefined}
      onExport={handlePreviewExport}
    />
    </>
  );
}

// ── All User Snapshots (Super Admin only) ──────────────────────────

function AllUserSnapshotsPanel() {
  const [snapshots, setSnapshots] = useState<AllUserCloudSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const loadSnapshots = useCallback(async () => {
    setLoading(true);
    try {
      const result = await Promise.race([
        (async () => {
          const { fetchAllCloudSnapshots } = await import('@/lib/cloud-backup');
          return await fetchAllCloudSnapshots();
        })(),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 15000)),
      ]);
      if (result === 'timeout') {
        toast.error("Loading all user snapshots timed out");
      } else {
        setSnapshots(result);
      }
    } catch {
      toast.error("Failed to load all user snapshots");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  const handleServerRestore = async (snapshotId: string) => {
    setRestoring(snapshotId);
    try {
      const { restoreSnapshotToServer } = await import('@/lib/cloud-backup');
      const ok = await restoreSnapshotToServer(snapshotId);
      if (ok) {
        toast.success("Snapshot restored to database");
      } else {
        toast.error("Failed to restore snapshot to database");
      }
    } catch (error) {
      console.error('[All User Snapshots] Restore failed:', error);
      toast.error("Restore failed");
    } finally {
      setRestoring(null);
    }
  };

  const handleExport = async (snapshotId: string, reportType: string, reportId: string) => {
    try {
      const { fetchCloudSnapshot } = await import('@/lib/cloud-backup');
      const full = await fetchCloudSnapshot(snapshotId);
      if (!full) { toast.error("Failed to fetch snapshot"); return; }
      const blob = new Blob([JSON.stringify(full.snapshot_data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const org = full?.snapshot_data?.parent?.organization as string | undefined;
      a.download = formatReportFilename(org || undefined, toFilenameReportType(reportType), 'json');
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Exported as JSON");
    } catch {
      toast.error("Export failed");
    }
  };

  const toggleUser = (userId: string) => {
    setExpandedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };

  const formatDate = (ts: number) => {
    try { return format(new Date(ts), "MMM d, yyyy h:mm a"); } catch { return "N/A"; }
  };

  // Filter then group snapshots by user
  const filteredSnapshots = snapshots.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (s.facility || '').toLowerCase().includes(q)
        || (s.user_name || '').toLowerCase().includes(q)
        || (s.report_type || '').replace('_', ' ').toLowerCase().includes(q)
        || (s.device || '').toLowerCase().includes(q)
        || (s.report_id || '').toLowerCase().includes(q);
  });

  const grouped = filteredSnapshots.reduce<Record<string, { name: string; items: AllUserCloudSnapshot[] }>>((acc, s) => {
    if (!acc[s.user_id]) acc[s.user_id] = { name: s.user_name, items: [] };
    acc[s.user_id].items.push(s);
    return acc;
  }, {});

  const userEntries = Object.entries(grouped).sort((a, b) => a[1].name.localeCompare(b[1].name));

  return (
    <Card className="backdrop-blur-md bg-white/5 dark:bg-white/[0.03] border border-white/10 rounded-xl shadow-lg shadow-black/5 overflow-hidden">
      <CardHeader className="px-3 md:px-6 py-4 md:p-6">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-amber-400 shrink-0" />
              All User Snapshots
            </CardTitle>
            <CardDescription className="mt-2 break-words" style={{ overflowWrap: 'anywhere' }}>
              Cloud backup snapshots across all users. Restore pushes data directly to the database.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={loadSnapshots} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-3 md:px-6 pb-4 md:pb-6 pt-0">
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading all user snapshots...
          </div>
        ) : snapshots.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No cloud backup snapshots found across any users.
          </div>
        ) : (
          <>
            <RecoverySearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search by facility, user, type, device, or ID..." />
            {userEntries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {snapshots.length > 0 ? `No snapshots match "${searchQuery}".` : 'No cloud backup snapshots found across any users.'}
              </div>
            ) : (
            <div className="space-y-2">
            {userEntries.map(([userId, { name, items }]) => {
              const isExpanded = expandedUsers.has(userId);
              return (
                <div key={userId} className="rounded-lg border border-white/10 overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
                    onClick={() => toggleUser(userId)}
                  >
                    <span className="font-medium text-sm">{name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">{items.length} snapshot{items.length !== 1 ? 's' : ''}</Badge>
                      <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-white/10 divide-y divide-white/5">
                      {items.map((s) => (
                        <div key={s.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <Badge variant="outline" className="text-xs shrink-0">{(s.report_type || '').replace('_', ' ')}</Badge>
                            <span className="text-xs text-muted-foreground truncate" title={s.facility}>{s.facility || 'N/A'}</span>
                            <span className="text-xs text-muted-foreground truncate">{s.device}</span>
                            <Badge variant={s.synced ? "default" : "destructive"} className="text-xs shrink-0">
                              {s.synced ? "Synced" : "Unsynced"}
                            </Badge>
                            <span className="text-xs text-muted-foreground shrink-0">{formatDate(s.snapshot_ts)}</span>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleServerRestore(s.id)}
                              disabled={restoring === s.id}
                              title="Restore to database"
                            >
                              {restoring === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleExport(s.id, s.report_type, s.report_id)}
                              title="Export as JSON"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Admin Edit History Panel ──────────────────────────────────────

function AdminEditHistoryPanel() {
  const [snapshots, setSnapshots] = useState<AdminEditSnapshotEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const loadSnapshots = useCallback(async () => {
    setLoading(true);
    try {
      const result = await Promise.race([
        fetchAdminEditSnapshots(),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 15000)),
      ]);
      if (result === 'timeout') {
        toast.error("Loading admin edit history timed out");
      } else {
        setSnapshots(result);
      }
    } catch {
      toast.error("Failed to load admin edit history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  const handleRestore = async (snapshotId: string) => {
    setRestoring(snapshotId);
    // H2: Hold restore lock during server-side admin restore so concurrent
    // auto-sync cycles don't push stale local edits over the original data
    // we're about to write back to the server.
    await withRestoreLock(async () => {
      try {
        const ok = await restoreAdminEditSnapshot(snapshotId);
        if (ok) {
          toast.success("Original data restored to database");
        } else {
          toast.error("Failed to restore original data");
        }
      } catch (error) {
        console.error('[Admin Edit History] Restore failed:', error);
        toast.error("Restore failed");
      } finally {
        setRestoring(null);
      }
    });
  };

  const handleExport = async (snapshotId: string, reportType: string) => {
    try {
      const { data, error } = await supabase.from('admin_edit_snapshots')
        .select('snapshot_data')
        .eq('id', snapshotId)
        .single();
      if (error || !data) { toast.error("Failed to fetch snapshot"); return; }
      const blob = new Blob([JSON.stringify(data.snapshot_data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const snapshotData = data.snapshot_data as { parent?: { organization?: unknown } } | null;
      const orgRaw = snapshotData?.parent?.organization;
      const org = typeof orgRaw === 'string' ? orgRaw : undefined;
      a.download = formatReportFilename(org, toFilenameReportType(reportType), 'json');
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Exported as JSON");
    } catch {
      toast.error("Export failed");
    }
  };

  const formatDate = (ts: string) => {
    try { return format(new Date(ts), "MMM d, yyyy h:mm a"); } catch { return "N/A"; }
  };

  return (
    <Card className="backdrop-blur-md bg-white/5 dark:bg-white/[0.03] border border-white/10 rounded-xl shadow-lg shadow-black/5 overflow-hidden">
      <CardHeader className="px-3 md:px-6 py-4 md:p-6">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-orange-400 shrink-0" />
              Admin Edit History
            </CardTitle>
            <CardDescription className="mt-2 break-words" style={{ overflowWrap: 'anywhere' }}>
              Pre-edit snapshots captured before an admin modified another user's report. Restore to undo admin changes.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={loadSnapshots} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-3 md:px-6 pb-4 md:pb-6 pt-0">
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading admin edit history...
          </div>
        ) : snapshots.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No admin edit snapshots found. Snapshots are captured automatically when a super admin modifies another user's report.
          </div>
        ) : (
          <>
          <RecoverySearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search by type, owner, editor, or ID..." />
          <div className="space-y-2">
            {(() => {
              const filtered = snapshots.filter(s => {
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return (s.report_type || '').replace('_', ' ').toLowerCase().includes(q)
                    || (s.owner_name || '').toLowerCase().includes(q)
                    || (s.editor_name || '').toLowerCase().includes(q)
                    || (s.report_id || '').toLowerCase().includes(q);
              });
              if (filtered.length === 0) return (
                <div className="text-center py-8 text-muted-foreground">
                  No snapshots match &ldquo;{searchQuery}&rdquo;.
                </div>
              );
              return filtered.map((s) => (
              <div key={s.id} className="rounded-lg border border-white/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                  <Badge variant="outline" className="text-xs shrink-0">{(s.report_type || '').replace('_', ' ')}</Badge>
                  <span className="text-xs text-muted-foreground truncate">Owner: {s.owner_name}</span>
                  <span className="text-xs text-muted-foreground truncate">Edited by: {s.editor_name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{formatDate(s.created_at)}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRestore(s.id)}
                    disabled={restoring === s.id}
                    title="Restore original data"
                  >
                    {restoring === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleExport(s.id, s.report_type)}
                    title="Export as JSON"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ));
            })()}
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
  const [searchQuery, setSearchQuery] = useState('');
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
        new Promise<[DbRow[], DbRow[], DbRow[], QueuedInspectionOp[], QueuedAssessmentOp[], QueuedTrainingOp[]]>((_, reject) =>
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

  const toggleSelectAll = (prefix: string, ops: QueuedOp[]) => {
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
    } catch (e) {
      const msg = errorMessage(e, '');
      toast.error(msg.includes('timeout') ? "Operation timed out — some items may not have been deleted" : "Failed to delete selected operations");
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

  const syncTrainingToDatabase = async (training: DbRow) => {
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
    } catch (error) {
      console.error("[Data Recovery] Sync failed:", error);
      toast.error(errorMessage(error, "Failed to sync training"));
    } finally {
      setSyncing(null);
    }
  };

  const syncDailyAssessmentToDatabase = async (assessment: DbRow) => {
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
    } catch (error) {
      console.error("[Data Recovery] Sync failed:", error);
      toast.error(errorMessage(error, "Failed to sync daily assessment"));
    } finally {
      setSyncing(null);
    }
  };

  const syncInspectionToDatabase = async (inspection: DbRow) => {
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
    } catch (error) {
      console.error("[Data Recovery] Sync failed:", error);
      toast.error(errorMessage(error, "Failed to sync inspection"));
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
    } catch (error) {
      console.error("[Data Recovery] Delete failed:", error);
      toast.error(errorMessage(error, "Failed to delete"));
    } finally {
      setDeleteConfirm(null);
    }
  };

  const getSyncStatus = (item: DbRow) => {
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

  const idbMatch = (item: DbRow) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (item.organization || '').toLowerCase().includes(q)
        || (item.location || '').toLowerCase().includes(q)
        || (item.site || '').toLowerCase().includes(q)
        || (item.id || '').toLowerCase().includes(q)
        || (item.status || '').toLowerCase().includes(q)
        || (item.trainer_of_record || '').toLowerCase().includes(q);
  };

  const filteredTrainings = localData?.trainings.filter(idbMatch) || [];
  const filteredAssessments = localData?.dailyAssessments.filter(idbMatch) || [];
  const filteredInspections = localData?.inspections.filter(idbMatch) || [];

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
        <RecoverySearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search by organization, location, ID, or status..." />
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
              {filteredTrainings.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {searchQuery ? `No trainings match "${searchQuery}".` : 'No local training data found'}
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
                      {filteredTrainings.map((training) => {
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
              {filteredAssessments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {searchQuery ? `No assessments match "${searchQuery}".` : 'No local daily assessment data found'}
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
                      {filteredAssessments.map((assessment) => {
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
              {filteredInspections.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {searchQuery ? `No inspections match "${searchQuery}".` : 'No local inspection data found'}
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
                      {filteredInspections.map((inspection) => {
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
