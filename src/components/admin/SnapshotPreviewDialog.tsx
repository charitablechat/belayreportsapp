import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  ChevronDown, ChevronRight, Copy, Download, RotateCcw, X, Image as ImageIcon,
  FileText, Database, Clock, MapPin, User, Hash, Smartphone, Cloud as CloudIcon,
} from "lucide-react";

type SnapshotShape = {
  parent?: Record<string, any> | null;
  children?: Record<string, any[]> | null;
} | null | undefined;

interface SnapshotPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshotData: SnapshotShape;
  reportType?: string;
  meta?: {
    snapshotId?: string;
    device?: string;
    timestamp?: number | string;
    synced?: boolean;
    sizeBytes?: number;
    userName?: string;
    source?: 'local' | 'cloud';
  };
  onRestore?: () => void | Promise<void>;
  onExport?: () => void;
  loading?: boolean;
}

const PARENT_FIELD_LABELS: Record<string, string> = {
  organization: "Organization",
  location: "Location",
  site: "Site",
  inspection_date: "Inspection Date",
  start_date: "Start Date",
  assessment_date: "Assessment Date",
  inspector_name: "Inspector",
  trainer_of_record: "Trainer of Record",
  status: "Status",
  acct_number: "Account #",
  onsite_contact: "Onsite Contact",
  previous_inspector: "Previous Inspector",
  app_version_at_completion: "App Version",
  attestation_signer_name: "Signed By",
  attestation_signed_at: "Signed At",
  report_version: "Report Version",
  updated_at: "Last Updated",
  created_at: "Created",
};

const HIDDEN_PARENT_FIELDS = new Set([
  "id", "deleted_at", "deleted_by", "retention_until", "field_timestamps",
  "latest_report_html", "latest_report_generated_at", "attestation_ip",
  "attestation_user_agent", "attestation_text", "synced_at", "last_sync_source",
  "last_opened_at", "last_modified_by", "active_duration_seconds",
  "inspector_id", "attestation_signer_id", "organization_id", "started_at",
]);

const LONG_TEXT_FIELDS = new Set([
  "course_history", "environment_comments", "structure_comments",
  "systems_comments", "critical_actions", "future_considerations",
  "repairs_performed", "comments", "notes",
]);

const stripHtml = (html: string): string => {
  if (!html || typeof html !== "string") return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
};

const formatValue = (key: string, value: any): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key.endsWith("_at") || key.endsWith("_date")) {
    try {
      const d = new Date(value);
      if (!isNaN(d.getTime())) return format(d, "MMM d, yyyy h:mm a");
    } catch { /* fall through */ }
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const CHILD_TABLE_COLUMNS: Record<string, { key: string; label: string }[]> = {
  inspection_systems: [
    { key: "system_name", label: "System" },
    { key: "name", label: "Name" },
    { key: "result", label: "Result" },
    { key: "comments", label: "Comments" },
  ],
  inspection_equipment: [
    { key: "equipment_type", label: "Type" },
    { key: "equipment_category", label: "Category" },
    { key: "quantity", label: "Qty" },
    { key: "result", label: "Result" },
    { key: "comments", label: "Comments" },
  ],
  inspection_ziplines: [
    { key: "zipline_name", label: "Zipline" },
    { key: "cable_type", label: "Cable" },
    { key: "result", label: "Result" },
    { key: "comments", label: "Comments" },
  ],
  inspection_standards: [
    { key: "standard_name", label: "Standard" },
    { key: "has_documentation", label: "Documented" },
    { key: "comments", label: "Comments" },
  ],
  inspection_summary: [
    { key: "critical_actions", label: "Critical Actions" },
    { key: "repairs_performed", label: "Repairs" },
    { key: "future_considerations", label: "Future" },
    { key: "next_inspection_date", label: "Next Inspection" },
  ],
  training_delivery_approaches: [
    { key: "approach", label: "Approach" },
    { key: "is_used", label: "Used" },
    { key: "comments", label: "Comments" },
  ],
  training_operating_systems: [
    { key: "system_name", label: "System" },
    { key: "comments", label: "Comments" },
  ],
  training_immediate_attention: [
    { key: "item_text", label: "Item" },
    { key: "is_addressed", label: "Addressed" },
  ],
  training_verifiable_items: [
    { key: "item_text", label: "Item" },
    { key: "is_verified", label: "Verified" },
  ],
  training_systems_in_place: [
    { key: "item_text", label: "Item" },
    { key: "is_in_place", label: "In Place" },
  ],
  training_summary: [
    { key: "observations", label: "Observations" },
    { key: "recommendations", label: "Recommendations" },
  ],
  daily_assessment_beginning_of_day: [
    { key: "item_key", label: "Item" },
    { key: "is_complete", label: "Complete" },
    { key: "comments", label: "Comments" },
  ],
  daily_assessment_end_of_day: [
    { key: "item_key", label: "Item" },
    { key: "is_complete", label: "Complete" },
    { key: "comments", label: "Comments" },
  ],
  daily_assessment_environment_checks: [
    { key: "item_key", label: "Item" },
    { key: "is_checked", label: "Checked" },
    { key: "comments", label: "Comments" },
  ],
  daily_assessment_equipment_checks: [
    { key: "item_key", label: "Item" },
    { key: "is_checked", label: "Checked" },
    { key: "comments", label: "Comments" },
  ],
  daily_assessment_structure_checks: [
    { key: "item_key", label: "Item" },
    { key: "is_checked", label: "Checked" },
    { key: "comments", label: "Comments" },
  ],
  daily_assessment_operating_systems: [
    { key: "system_name", label: "System" },
    { key: "other_description", label: "Description" },
  ],
};

const PHOTO_TABLES = new Set([
  "inspection_photos", "training_photos", "daily_assessment_photos",
]);

const friendlySectionName = (key: string) =>
  key.replace(/_/g, " ").replace(/^(inspection|training|daily assessment)\s+/i, "");

export function SnapshotPreviewDialog({
  open, onOpenChange, snapshotData, reportType, meta, onRestore, onExport, loading = false,
}: SnapshotPreviewDialogProps) {
  const [showRawJson, setShowRawJson] = useState(false);
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const parent = snapshotData?.parent ?? null;
  const children = snapshotData?.children ?? {};

  const orgName = parent?.organization || (meta as any)?.facility || "Unknown";
  const dateField = parent?.inspection_date || parent?.assessment_date || parent?.start_date || parent?.created_at;
  const ts = typeof meta?.timestamp === "number"
    ? meta.timestamp
    : meta?.timestamp ? new Date(meta.timestamp).getTime() : null;

  const childEntries = useMemo(() => {
    return Object.entries(children || {})
      .filter(([, rows]) => Array.isArray(rows) && rows.length > 0)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [children]);

  const totalChildRows = useMemo(
    () => childEntries.reduce((sum, [, rows]) => sum + (rows as any[]).length, 0),
    [childEntries]
  );

  const parentEntries = useMemo(() => {
    if (!parent) return [] as [string, any][];
    return Object.entries(parent)
      .filter(([k, v]) => !HIDDEN_PARENT_FIELDS.has(k) && v !== null && v !== undefined && v !== "")
      .sort(([a], [b]) => {
        const ai = Object.keys(PARENT_FIELD_LABELS).indexOf(a);
        const bi = Object.keys(PARENT_FIELD_LABELS).indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
  }, [parent]);

  const handleCopyId = () => {
    if (!meta?.snapshotId) return;
    navigator.clipboard.writeText(meta.snapshotId).then(() => toast.success("Snapshot ID copied"));
  };

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(snapshotData, null, 2))
      .then(() => toast.success("Raw JSON copied to clipboard"));
  };

  const handleRestoreConfirm = async () => {
    if (!onRestore) return;
    setRestoring(true);
    try {
      await onRestore();
      setConfirmRestoreOpen(false);
      onOpenChange(false);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] p-0 gap-0 flex flex-col">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Database className="h-5 w-5 text-primary" />
              Snapshot Preview
            </DialogTitle>
            <DialogDescription>
              Review the contents of this snapshot before restoring.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="px-6 py-4 space-y-5">
              {loading ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  Loading snapshot…
                </div>
              ) : !snapshotData || !parent ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  Snapshot data is empty or unavailable.
                </div>
              ) : (
                <>
                  {/* Header band */}
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {reportType && (
                        <Badge variant="outline" className="text-xs">
                          {reportType.replace(/_/g, " ")}
                        </Badge>
                      )}
                      {meta?.synced !== undefined && (
                        <Badge variant={meta.synced ? "default" : "destructive"} className="text-xs">
                          {meta.synced ? "Synced" : "Unsynced"}
                        </Badge>
                      )}
                      {meta?.source && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          {meta.source === "cloud" ? <CloudIcon className="h-3 w-3" /> : <Database className="h-3 w-3" />}
                          {meta.source}
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Organization" value={orgName} />
                      {dateField && (
                        <InfoRow icon={<Clock className="h-3.5 w-3.5" />} label="Report Date" value={formatValue("inspection_date", dateField)} />
                      )}
                      {meta?.userName && (
                        <InfoRow icon={<User className="h-3.5 w-3.5" />} label="User" value={meta.userName} />
                      )}
                      {meta?.device && (
                        <InfoRow icon={<Smartphone className="h-3.5 w-3.5" />} label="Device" value={meta.device} />
                      )}
                      {ts && (
                        <InfoRow
                          icon={<Clock className="h-3.5 w-3.5" />}
                          label="Saved"
                          value={`${format(new Date(ts), "MMM d, yyyy h:mm a")} (${formatDistanceToNow(new Date(ts), { addSuffix: true })})`}
                        />
                      )}
                      {meta?.sizeBytes !== undefined && (
                        <InfoRow icon={<FileText className="h-3.5 w-3.5" />} label="Size" value={`${(meta.sizeBytes / 1024).toFixed(1)} KB`} />
                      )}
                      {meta?.snapshotId && (
                        <div className="flex items-center gap-1.5 text-xs col-span-1 sm:col-span-2 min-w-0">
                          <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-muted-foreground shrink-0">ID</span>
                          <code className="font-mono truncate" title={meta.snapshotId}>{meta.snapshotId.substring(0, 16)}…</code>
                          <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={handleCopyId}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Summary chips */}
                  {childEntries.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        Contents ({totalChildRows} records)
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {childEntries.map(([table, rows]) => (
                          <Badge key={table} variant="secondary" className="text-xs font-normal">
                            {friendlySectionName(table)}: <span className="font-semibold ml-1">{(rows as any[]).length}</span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Parent record card */}
                  {parentEntries.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        Report Details
                      </div>
                      <div className="rounded-lg border divide-y">
                        {parentEntries.map(([key, value]) => (
                          <ParentRow key={key} fieldKey={key} value={value} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Child collections */}
                  {childEntries.map(([table, rows]) => (
                    <ChildSection key={table} table={table} rows={rows as any[]} />
                  ))}

                  {/* Raw JSON disclosure */}
                  <Collapsible open={showRawJson} onOpenChange={setShowRawJson}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full justify-start gap-2">
                        {showRawJson ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        View raw JSON
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                      <div className="relative">
                        <Button
                          size="sm" variant="outline"
                          className="absolute top-2 right-2 z-10 h-7 gap-1"
                          onClick={handleCopyJson}
                        >
                          <Copy className="h-3 w-3" /> Copy
                        </Button>
                        <pre className="rounded-md border bg-muted/50 p-3 text-xs font-mono overflow-x-auto max-h-80 overflow-y-auto">
                          {JSON.stringify(snapshotData, null, 2)}
                        </pre>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </>
              )}
            </div>
          </ScrollArea>

          <DialogFooter className="px-6 py-4 border-t flex-col-reverse sm:flex-row sm:justify-between gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4 mr-1.5" /> Close
            </Button>
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              {onExport && (
                <Button variant="outline" onClick={onExport} disabled={loading || !snapshotData}>
                  <Download className="h-4 w-4 mr-1.5" /> Export JSON
                </Button>
              )}
              {onRestore && (
                <Button onClick={() => setConfirmRestoreOpen(true)} disabled={loading || !snapshotData || restoring}>
                  <RotateCcw className="h-4 w-4 mr-1.5" /> Restore to Local
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRestoreOpen} onOpenChange={setConfirmRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace your current local draft of <strong>{orgName}</strong>
              {dateField ? <> ({formatValue("inspection_date", dateField)})</> : null}
              {" "}in this device's local storage. Your sync queue is unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestoreConfirm} disabled={restoring}>
              {restoring ? "Restoring…" : "Restore"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs min-w-0">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium truncate" title={value}>{value}</span>
    </div>
  );
}

function ParentRow({ fieldKey, value }: { fieldKey: string; value: any }) {
  const [expanded, setExpanded] = useState(false);
  const label = PARENT_FIELD_LABELS[fieldKey] || fieldKey.replace(/_/g, " ");
  const isLong = LONG_TEXT_FIELDS.has(fieldKey) && typeof value === "string" && value.length > 80;
  const display = typeof value === "string" && /<[a-z][\s\S]*>/i.test(value) ? stripHtml(value) : formatValue(fieldKey, value);
  const truncated = isLong && !expanded ? `${display.slice(0, 80)}…` : display;

  return (
    <div className="px-3 py-2 grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-3 text-sm">
      <div className="text-xs text-muted-foreground capitalize sm:pt-0.5">{label}</div>
      <div className="sm:col-span-2 break-words" style={{ overflowWrap: "anywhere" }}>
        {truncated}
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-2 text-xs text-primary hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    </div>
  );
}

function ChildSection({ table, rows }: { table: string; rows: any[] }) {
  const [open, setOpen] = useState(false);
  const isPhotos = PHOTO_TABLES.has(table);
  const cols = CHILD_TABLE_COLUMNS[table] || inferColumns(rows);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center justify-between rounded-md border bg-muted/30 hover:bg-muted/50 transition-colors px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {isPhotos && <ImageIcon className="h-4 w-4 text-muted-foreground" />}
            <span className="capitalize">{friendlySectionName(table)}</span>
          </div>
          <Badge variant="secondary" className="text-xs">{rows.length}</Badge>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        {isPhotos ? (
          <PhotoGrid rows={rows} />
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {cols.map((c) => (
                    <TableHead key={c.key} className="text-xs">{c.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 50).map((row, i) => (
                  <TableRow key={row.id || i}>
                    {cols.map((c) => (
                      <TableCell key={c.key} className="text-xs max-w-[240px] truncate" title={String(row[c.key] ?? "")}>
                        {formatCellValue(row[c.key])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {rows.length > 50 && (
              <div className="px-3 py-1.5 text-xs text-muted-foreground border-t bg-muted/20">
                Showing first 50 of {rows.length} rows. Use raw JSON view to see all.
              </div>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function inferColumns(rows: any[]): { key: string; label: string }[] {
  const sample = rows[0] || {};
  return Object.keys(sample)
    .filter((k) => !["id", "created_at", "deleted_at", "retention_until", "display_order"].includes(k))
    .slice(0, 4)
    .map((k) => ({ key: k, label: k.replace(/_/g, " ") }));
}

function formatCellValue(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (typeof v === "string" && /<[a-z][\s\S]*>/i.test(v)) return stripHtml(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function PhotoGrid({ rows }: { rows: any[] }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 p-2 rounded-md border bg-muted/20">
      {rows.map((p, i) => (
        <PhotoThumb key={p.id || i} url={p.photo_url} caption={p.caption} />
      ))}
    </div>
  );
}

function PhotoThumb({ url, caption }: { url?: string; caption?: string }) {
  const [errored, setErrored] = useState(false);
  if (!url || errored) {
    return (
      <div className="aspect-square rounded border bg-muted flex items-center justify-center" title={caption || "Photo unavailable"}>
        <ImageIcon className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="aspect-square rounded border overflow-hidden bg-muted block" title={caption}>
      <img src={url} alt={caption || "Snapshot photo"} loading="lazy" onError={() => setErrored(true)} className="w-full h-full object-cover" />
    </a>
  );
}
