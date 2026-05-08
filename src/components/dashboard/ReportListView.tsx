import { useEffect, useState } from "react";
import { format, differenceInDays, formatDistanceToNow } from "date-fns";
import {
  Building2,
  HardHat,
  ClipboardCheck,
  GraduationCap,
  MoreVertical,
  Trash2,
  Download,
  Receipt,
  Cloud,
  Check,
  UploadCloud,
  DollarSign,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { parseLocalDate } from "@/lib/date-utils";
import { triggerHaptic } from "@/lib/haptics";
import { getReportDate, getAssigneeName } from "@/lib/report-utils";
import { usePWA } from "@/hooks/usePWA";
import { cn } from "@/lib/utils";
import { getReportAgeState, type ReportAgeState } from "./ReportCard";

const ROW_TINT_CLASSES: Record<ReportAgeState, string> = {
  critical: "bg-red-100 hover:bg-red-100/80 dark:bg-red-950/40 dark:hover:bg-red-950/60",
  warning: "bg-yellow-50 hover:bg-yellow-100/80 dark:bg-yellow-950/30 dark:hover:bg-yellow-950/50",
  completed: "bg-sky-200/70 hover:bg-sky-200 dark:bg-sky-900/40 dark:hover:bg-sky-900/60",
  default: "bg-card hover:bg-accent/30",
};
const INVOICED_TINT =
  "bg-teal-100 hover:bg-teal-100/80 dark:bg-teal-950/40 dark:hover:bg-teal-950/60";
const INVOICED_ACCENT = "bg-teal-500 dark:bg-teal-400";

type ReportType = "inspection" | "training" | "daily";

interface ReportListViewProps {
  reports: any[];
  type: ReportType;
  onRowClick: (report: any) => void;
  onDelete?: (report: any) => void;
  compact?: boolean;
  isAdmin?: boolean;
  invoicedReportIds?: Set<string>;
  invoicedMetaById?: ReadonlyMap<
    string,
    { invoiced_at: string; invoiced_by: string | null }
  >;
  onToggleInvoiced?: (report: any, type: ReportType) => void;
  profilesById?: ReadonlyMap<
    string,
    { first_name: string | null; last_name: string | null; avatar_url: string | null }
  >;
  getStatusBadge?: (report: any) => React.ReactNode;
  twoColumn?: boolean;
}

function getTypeIcon(type: ReportType) {
  if (type === "training") return GraduationCap;
  if (type === "daily") return ClipboardCheck;
  return HardHat;
}

function getAccentClasses(createdAt: string | null | undefined, status?: string) {
  if (!createdAt) return "bg-slate-300";
  const age = differenceInDays(new Date(), new Date(createdAt));
  if (status === "completed") return "bg-sky-500";
  if (age <= 7) return "bg-emerald-500";
  if (age <= 30) return "bg-amber-500";
  return "bg-slate-400";
}

function getStatusPillClasses(status: string | undefined): string {
  switch (status) {
    case "completed":
      return "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900";
    case "in_progress":
    case "in-progress":
      return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900";
    case "draft":
    default:
      return "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700";
  }
}

function ReportRow({
  report,
  type,
  onRowClick,
  onDelete,
  compact,
  isAdmin,
  invoicedReportIds,
  invoicedMetaById,
  onToggleInvoiced,
  profilesById,
  getStatusBadge,
  twoColumn,
}: {
  report: any;
  type: ReportType;
} & Omit<ReportListViewProps, "reports" | "type">) {
  const Icon = getTypeIcon(type);
  const status = report.status as string | undefined;
  const dateStr = getReportDate(report, type);
  const parsed = dateStr ? parseLocalDate(dateStr) : null;

  const createdAt = report.created_at as string | null | undefined;
  const baseAccent = getAccentClasses(createdAt, status);

  // Inspector / assignee
  const assigneeName = getAssigneeName(report, type, profilesById ?? undefined);
  const firstName = assigneeName.split(" ")[0] || "—";
  const fallbackProfile =
    typeof report?.inspector_id === "string"
      ? profilesById?.get(report.inspector_id) || null
      : null;
  const avatarUrl =
    type === "training"
      ? report.trainer?.avatar_url || fallbackProfile?.avatar_url || null
      : report.inspector?.avatar_url || fallbackProfile?.avatar_url || null;
  const initials =
    assigneeName && assigneeName !== "Unknown"
      ? assigneeName
          .split(" ")
          .filter(Boolean)
          .slice(0, 2)
          .map((p: string) => p[0])
          .join("")
          .toUpperCase()
      : "?";

  // Sync status (mirror ReportCard logic)
  const { photosByInspection } = usePWA();
  const pendingPhotos =
    type === "inspection" ? photosByInspection?.[report.id] ?? 0 : 0;
  const isSynced = !!report.synced_at;

  const isInvoiced = invoicedReportIds?.has(report.id) ?? false;
  const invoicedMeta = invoicedMetaById?.get(report.id);

  // Meta line: location · assignee · X days ago
  const metaParts: string[] = [];
  if (report.location || report.site) metaParts.push(report.location || report.site);
  if (assigneeName && assigneeName !== "Unknown") metaParts.push(assigneeName);
  if (createdAt) {
    try {
      metaParts.push(formatDistanceToNow(new Date(createdAt), { addSuffix: true }));
    } catch {
      /* noop */
    }
  }

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => {
        triggerHaptic("light");
        onRowClick(report);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          triggerHaptic("light");
          onRowClick(report);
        }
      }}
      className={cn(
        "group relative flex items-center gap-3 overflow-hidden rounded-xl border border-border transition-colors cursor-pointer",
        isAdmin && isInvoiced ? INVOICED_TINT : ROW_TINT_CLASSES[getReportAgeState(createdAt, status ?? "")],
        compact ? "py-2 pr-2" : "py-3 pr-3",
      )}
    >
      {/* 3px accent bar */}
      <span
        aria-hidden
        className={cn("absolute left-0 top-0 h-full w-[3px]", isAdmin && isInvoiced ? INVOICED_ACCENT : baseAccent)}
      />

      {/* Icon tile */}
      <div
        className={cn(
          "ml-3 flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary",
          compact ? "h-9 w-9" : "h-10 w-10",
        )}
      >
        <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
      </div>

      {/* Primary column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="truncate text-base font-semibold leading-tight"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
        >
          {report.organization || "Untitled"}
        </div>
        {metaParts.length > 0 && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {metaParts.join(" · ")}
          </div>
        )}
      </div>

      {/* Inspector chip — hidden <sm */}
      <div className="hidden sm:flex shrink-0 items-center gap-1.5 max-w-[140px]">
        <Avatar className="h-6 w-6">
          <AvatarImage src={avatarUrl || undefined} alt={assigneeName} />
          <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className="truncate text-xs text-muted-foreground">{firstName}</span>
      </div>

      {/* Status pill */}
      {status && !(twoColumn && isAdmin && isInvoiced && status === "completed") && (
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
            getStatusPillClasses(status),
          )}
        >
          {status.replace(/[_-]/g, " ")}
        </span>
      )}

      {/* Inspection custom status badge (passed via getStatusBadge) */}
      {getStatusBadge && type === "inspection" && (
        <div className="hidden md:block shrink-0">{getStatusBadge(report)}</div>
      )}

      {/* Invoiced pill */}
      {isAdmin && isInvoiced && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="hidden md:inline-flex shrink-0 items-center gap-1 rounded-full bg-teal-600 px-2.5 py-0.5 text-xs font-semibold text-white ring-1 ring-inset ring-teal-700/40 dark:bg-teal-500 dark:ring-teal-300/40">
              <DollarSign className="w-3 h-3" /> Invoiced
            </span>
          </TooltipTrigger>
          {invoicedMeta && (
            <TooltipContent>
              {(() => {
                const profile = invoicedMeta.invoiced_by
                  ? profilesById?.get(invoicedMeta.invoiced_by)
                  : null;
                const byName = profile
                  ? [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() ||
                    "Unknown"
                  : invoicedMeta.invoiced_by
                  ? "Unknown"
                  : null;
                let when = "";
                try {
                  when = format(new Date(invoicedMeta.invoiced_at), "PP · p");
                } catch {
                  /* noop */
                }
                return (
                  <span>
                    {when}
                    {byName ? ` · by ${byName}` : ""}
                  </span>
                );
              })()}
            </TooltipContent>
          )}
        </Tooltip>
      )}

      {/* Sync chip */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="shrink-0 inline-flex items-center justify-center text-muted-foreground">
            {isSynced ? (
              pendingPhotos > 0 ? (
                <UploadCloud className="h-4 w-4 text-amber-500" />
              ) : (
                <Check className="h-4 w-4 text-emerald-600" />
              )
            ) : (
              <Cloud className="h-4 w-4" />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {isSynced
            ? pendingPhotos > 0
              ? `Synced — ${pendingPhotos} photo${pendingPhotos === 1 ? "" : "s"} uploading`
              : "Synced"
            : "Local only"}
        </TooltipContent>
      </Tooltip>

      {/* Date — hidden <md */}
      <div className="hidden md:block shrink-0 text-xs text-muted-foreground tabular-nums w-[92px] text-right">
        {parsed ? format(parsed, "MMM d, yyyy") : "—"}
      </div>

      {/* Kebab */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              triggerHaptic("light");
            }}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onRowClick(report);
            }}
          >
            Open
          </DropdownMenuItem>
          {report.pdf_url && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                window.open(report.pdf_url, "_blank");
              }}
            >
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </DropdownMenuItem>
          )}
          {isAdmin && status === "completed" && onToggleInvoiced && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onToggleInvoiced(report, type);
              }}
              className={
                isInvoiced
                  ? "text-amber-600 focus:text-amber-600"
                  : "text-red-600 focus:text-red-600"
              }
            >
              <Receipt className="w-4 h-4 mr-2" />
              {isInvoiced ? "Remove Invoice" : "Mark Invoice"}
            </DropdownMenuItem>
          )}
          {onDelete && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onDelete(report);
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function ReportListView({
  reports,
  type,
  onRowClick,
  onDelete,
  compact,
  isAdmin,
  invoicedReportIds,
  invoicedMetaById,
  onToggleInvoiced,
  profilesById,
  getStatusBadge,
  twoColumn,
}: ReportListViewProps) {
  // Auto-imply compact when twoColumn is on, unless caller explicitly set it.
  const effectiveCompact = compact ?? twoColumn ?? false;
  const containerClass = twoColumn
    ? "grid grid-cols-1 md:grid-cols-2 gap-2"
    : cn("flex flex-col", effectiveCompact ? "gap-1.5" : "gap-2");
  return (
    <ul className={containerClass}>
      {reports.map((r) => (
        <ReportRow
          key={r.id}
          report={r}
          type={type}
          onRowClick={onRowClick}
          onDelete={onDelete}
          compact={effectiveCompact}
          isAdmin={isAdmin}
          invoicedReportIds={invoicedReportIds}
          invoicedMetaById={invoicedMetaById}
          onToggleInvoiced={onToggleInvoiced}
          profilesById={profilesById}
          getStatusBadge={getStatusBadge}
          twoColumn={twoColumn}
        />
      ))}
    </ul>
  );
}
