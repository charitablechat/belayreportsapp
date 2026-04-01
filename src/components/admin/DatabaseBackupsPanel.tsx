import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Database, Download, Upload, Loader2, Clock, HardDrive, RefreshCw, FileSpreadsheet, FileArchive, FileJson, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import {
  triggerFullBackup,
  downloadBackupFile,
  downloadBackupFileRaw,
  listServerBackups,
  getLatestBackup,
  restoreFromFile,
  restoreFromServer,
  formatFileSize,
} from "@/lib/full-backup";
import { downloadBackupAsExcel, downloadBackupAsCsv } from "@/lib/backup-export";

export function DatabaseBackupsPanel() {
  const queryClient = useQueryClient();
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [restoreSource, setRestoreSource] = useState<{ type: "file"; file: File } | { type: "server"; path: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptShownRef = useRef(false);

  const { data: backups, isLoading } = useQuery({
    queryKey: ["backup-history"],
    queryFn: listServerBackups,
  });

  // Auto-prompt for download if latest backup > 7 days old
  useEffect(() => {
    if (promptShownRef.current || !backups) return;
    const latest = backups[0];
    if (!latest) return;

    const ageMs = Date.now() - new Date(latest.created_at).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (ageMs < sevenDays) {
      // Check if user already dismissed/downloaded this backup
      const lastDismissed = localStorage.getItem("lastBackupDismissedId");
      if (lastDismissed === latest.id) return;

      promptShownRef.current = true;
      toast("A recent database backup is available", {
        description: `Created ${formatDistanceToNow(new Date(latest.created_at), { addSuffix: true })}`,
        duration: 15000,
        action: {
          label: "Download",
          onClick: () => handleDownload(latest.file_path),
        },
        onDismiss: () => localStorage.setItem("lastBackupDismissedId", latest.id),
      });
    }
  }, [backups]);

  const handleBackupNow = async () => {
    setIsBackingUp(true);
    try {
      const result = await triggerFullBackup();
      toast.success("Backup created successfully", {
        description: `${formatFileSize(result.file_size_bytes)} saved to server`,
      });
      queryClient.invalidateQueries({ queryKey: ["backup-history"] });
    } catch (err: any) {
      toast.error("Backup failed", { description: err.message });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleDownload = async (filePath: string, format: "json" | "excel" | "csv" = "json") => {
    setIsDownloading(filePath);
    try {
      if (format === "json") {
        await downloadBackupFile(filePath);
      } else {
        const blob = await downloadBackupFileRaw(filePath);
        if (format === "excel") {
          await downloadBackupAsExcel(blob);
        } else {
          await downloadBackupAsCsv(blob);
        }
      }
      toast.success("Download started");
    } catch (err: any) {
      toast.error("Download failed", { description: err.message });
    } finally {
      setIsDownloading(null);
    }
  };

  const handleRestoreFromFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreSource({ type: "file", file });
    setRestoreDialogOpen(true);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRestoreFromServer = (filePath: string) => {
    setRestoreSource({ type: "server", path: filePath });
    setRestoreDialogOpen(true);
  };

  const confirmRestore = async () => {
    if (!restoreSource) return;
    setIsRestoring(true);
    setRestoreDialogOpen(false);
    try {
      if (restoreSource.type === "file") {
        await restoreFromFile(restoreSource.file);
      } else {
        await restoreFromServer(restoreSource.path);
      }
      toast.success("Database restored successfully");
      queryClient.invalidateQueries();
    } catch (err: any) {
      toast.error("Restore failed", { description: err.message });
    } finally {
      setIsRestoring(false);
      setRestoreSource(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Database Backups
          </CardTitle>
          <CardDescription>
            Full database backups are stored on the server and run automatically every week.
            You can also trigger a manual backup or restore from a previous backup.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={handleBackupNow} disabled={isBackingUp || isRestoring}>
            {isBackingUp ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating backup...
              </>
            ) : (
              <>
                <HardDrive className="h-4 w-4" />
                Backup Now
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isRestoring || isBackingUp}
          >
            {isRestoring ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Restoring...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Restore from File
              </>
            )}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleRestoreFromFile}
            className="hidden"
          />
        </CardContent>
      </Card>

      {/* Backup History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Backup History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !backups || backups.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No backups yet. Click "Backup Now" to create the first one.
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Tables</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backups.map((backup) => {
                    const totalRecords = backup.table_counts
                      ? Object.values(backup.table_counts).reduce((a: number, b: any) => a + (Number(b) || 0), 0)
                      : 0;
                    return (
                      <TableRow key={backup.id}>
                        <TableCell>
                          <div className="space-y-0.5">
                            <div className="text-sm font-medium">
                              {format(new Date(backup.created_at), "PPp")}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(backup.created_at), { addSuffix: true })}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {backup.file_size_bytes ? formatFileSize(backup.file_size_bytes) : "—"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {totalRecords.toLocaleString()} records
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isDownloading === backup.file_path}
                                >
                                  {isDownloading === backup.file_path ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Download className="h-3 w-3" />
                                  )}
                                  Download
                                  <ChevronDown className="h-3 w-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleDownload(backup.file_path, "json")}>
                                  <FileJson className="h-4 w-4 mr-2" />
                                  JSON
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleDownload(backup.file_path, "excel")}>
                                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                                  Excel (.xlsx)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleDownload(backup.file_path, "csv")}>
                                  <FileArchive className="h-4 w-4 mr-2" />
                                  CSV (.zip)
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRestoreFromServer(backup.file_path)}
                              disabled={isRestoring}
                            >
                              <RefreshCw className="h-3 w-3" />
                              Restore
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

      {/* Restore Confirmation Dialog */}
      <AlertDialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Database Restore</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This will upsert all records from the backup into the database.
                  Existing records with matching IDs will be overwritten.
                </p>
                <p className="text-sm font-medium text-amber-500">
                  ⚠️ This operation cannot be undone. Make sure you have a current backup before proceeding.
                </p>
                {restoreSource?.type === "file" && (
                  <p className="text-sm">
                    File: <strong>{restoreSource.file.name}</strong> ({formatFileSize(restoreSource.file.size)})
                  </p>
                )}
                {restoreSource?.type === "server" && (
                  <p className="text-sm">
                    Restoring from: <strong>{restoreSource.path}</strong>
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRestore}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Restore Database
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
