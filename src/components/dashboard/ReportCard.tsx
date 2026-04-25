import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format, differenceInDays, formatDistanceToNow } from "date-fns";
import { FileText, MoreVertical, Trash2, Download, Check, Cloud, Receipt } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";
import { parseLocalDate } from "@/lib/date-utils";
import { triggerSuccessConfetti } from "@/lib/confetti";
import { cn } from "@/lib/utils";
import { useClickAndHoverSparkles, SparkleContainer } from "@/components/christmas/Sparkles";

// F2: Module-level minute-tick subscriber so we share ONE setInterval across all
// ReportCard instances on the page (not N intervals for N cards).
const tickSubscribers = new Set<() => void>();
let tickInterval: ReturnType<typeof setInterval> | null = null;
function subscribeMinuteTick(cb: () => void) {
  tickSubscribers.add(cb);
  if (!tickInterval) {
    tickInterval = setInterval(() => {
      tickSubscribers.forEach((fn) => fn());
    }, 60_000);
  }
  return () => {
    tickSubscribers.delete(cb);
    if (tickSubscribers.size === 0 && tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  };
}
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => subscribeMinuteTick(() => setTick((n) => n + 1)), []);
}

export type ReportAgeState = 'critical' | 'warning' | 'completed' | 'default';

export function getReportAgeState(createdAt: string | null | undefined, status: string): ReportAgeState {
  if (status === 'completed') return 'completed';
  if (!createdAt) return 'default';
  const age = differenceInDays(new Date(), new Date(createdAt));
  if (age > 5) return 'critical';
  if (age > 3) return 'warning';
  return 'default';
}

interface ReportCardProps {
  report: any;
  type: 'inspection' | 'training' | 'daily';
  onDelete: (report: any) => void;
  onClick: (report: any) => void;
  getStatusBadge?: (report: any) => React.ReactNode;
  compact?: boolean;
  isAdmin?: boolean;
  isInvoiced?: boolean;
  onToggleInvoiced?: (report: any, type: 'inspection' | 'training' | 'daily') => void;
  profilesById?: ReadonlyMap<string, { first_name: string | null; last_name: string | null; avatar_url: string | null }>;
}

export function ReportCard({ report, type, onDelete, onClick, getStatusBadge, compact, isAdmin, isInvoiced, onToggleInvoiced, profilesById }: ReportCardProps) {
  useMinuteTick(); // F2: re-render every 60s so "Edited X ago" stays current
  const { sparkles, triggerSparkles, handleMouseMove } = useClickAndHoverSparkles();
  const isInspection = type === 'inspection';
  const isDaily = type === 'daily';
  
  const getReportDate = () => {
    if (isInspection) return report.inspection_date;
    if (isDaily) return report.assessment_date;
    return report.training?.start_date || report.start_date;
  };

  const getReportOrganization = () => {
    if (isInspection) return report.organization;
    if (isDaily) return report.organization;
    return report.training?.organization || report.organization;
  };

  const getReportLocation = () => {
    if (isInspection) return report.location;
    return null;
  };

  // Resolve from cached profile map when the row's join was stripped
  // (e.g. after a local save / offline first paint).
  const fallbackProfile = (() => {
    const id = report?.inspector_id;
    if (typeof id === 'string' && profilesById) return profilesById.get(id) || null;
    return null;
  })();

  const getInspectorName = () => {
    // For training reports, try trainer profile first, then fallback map, then trainer_of_record
    if (type === 'training') {
      const firstName = report.trainer?.first_name || fallbackProfile?.first_name || '';
      const lastName = report.trainer?.last_name || fallbackProfile?.last_name || '';
      const trainerName = `${firstName} ${lastName}`.trim();
      return trainerName || report.trainer_of_record || 'Unknown';
    }

    // For daily assessments, try inspector profile first, then fallback, then trainer_of_record
    if (type === 'daily') {
      const firstName = report.inspector?.first_name || fallbackProfile?.first_name || '';
      const lastName = report.inspector?.last_name || fallbackProfile?.last_name || '';
      const inspectorName = `${firstName} ${lastName}`.trim();
      return inspectorName || report.trainer_of_record || 'Unknown';
    }

    // For inspections
    const firstName = report.inspector?.first_name || fallbackProfile?.first_name || '';
    const lastName = report.inspector?.last_name || fallbackProfile?.last_name || '';
    return `${firstName} ${lastName}`.trim() || 'Unknown';
  };

  const getInspectorAvatar = () => {
    if (type === 'training') {
      return report.trainer?.avatar_url || fallbackProfile?.avatar_url || null;
    }
    return report.inspector?.avatar_url || fallbackProfile?.avatar_url || null;
  };

  const getInspectorInitials = () => {
    const name = getInspectorName();
    if (name === 'Unknown') return '?';
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.charAt(0).toUpperCase();
  };

  const getReportStatus = () => {
    if (isInspection) return report.status;
    if (isDaily) return report.status;
    return report.training?.status || report.status;
  };

  const handleDownloadPDF = async (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic('light');
    
    if (report.pdf_url) {
      window.open(report.pdf_url, '_blank');
    }
  };

  const ageState = getReportAgeState(report.created_at, getReportStatus());

  const ageStateClasses: Record<ReportAgeState, string> = {
    critical: 'border-l-4 border-l-destructive bg-red-200 dark:bg-red-900/40',
    warning: 'border-l-4 border-l-amber-500 bg-yellow-50 dark:bg-yellow-950/30',
    completed: 'border-l-4 border-l-green-500',
    default: 'border-l-4 border-l-muted-foreground/30',
  };

  const getRelativeDate = () => {
    const dateStr = getReportDate();
    if (!dateStr) return null;
    const parsed = parseLocalDate(dateStr);
    if (!parsed) return null;
    return { full: format(parsed, "PPP"), relative: formatDistanceToNow(parsed, { addSuffix: true }) };
  };

  const getLastActivity = () => {
    const updatedAt = report.updated_at;
    if (!updatedAt) return null;
    try {
      return formatDistanceToNow(new Date(updatedAt), { addSuffix: true });
    } catch { return null; }
  };

  const dateInfo = getRelativeDate();
  const lastActivity = getLastActivity();

  return (
    <Card 
      className={cn(
        "relative overflow-visible cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/50 active:scale-[0.99] active:shadow-md group",
        ageStateClasses[ageState]
      )}
      onClick={(e) => {
        triggerHaptic('light');
        triggerSparkles(e);
        if (getReportStatus() === 'completed') {
          triggerSuccessConfetti();
        }
        onClick(report);
      }}
      onMouseMove={handleMouseMove}
    >
      {getReportStatus() === 'completed' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <span className="text-green-500/20 text-4xl md:text-5xl font-bold tracking-wider rotate-[-25deg] select-none whitespace-nowrap">
            COMPLETED
          </span>
          {isAdmin && isInvoiced && (
            <span className="absolute backdrop-blur-sm bg-red-500/10 border border-red-400/30 rounded-lg px-4 py-2 text-red-600 dark:text-red-400 text-4xl md:text-5xl font-bold tracking-wider rotate-[25deg] select-none whitespace-nowrap shadow-[0_0_20px_rgba(239,68,68,0.25)] animate-pulse-calm">
              INVOICED
            </span>
          )}
        </div>
      )}
      <CardContent className={cn("p-4 md:p-6", compact && "p-2.5 md:p-3")}>
        <div className="flex items-start justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            <h4 className="font-semibold text-sm md:text-base line-clamp-1">
              {getReportOrganization()}
            </h4>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button 
                variant="ghost" 
                size="icon"
                className="h-8 w-8 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  triggerHaptic('light');
                }}
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {report.pdf_url && (
                <DropdownMenuItem onClick={handleDownloadPDF}>
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF
                </DropdownMenuItem>
              )}
              {isAdmin && getReportStatus() === 'completed' && onToggleInvoiced && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleInvoiced(report, type);
                  }}
                  className={isInvoiced ? "text-amber-600 focus:text-amber-600" : "text-red-600 focus:text-red-600"}
                >
                  <Receipt className="w-4 h-4 mr-2" />
                  {isInvoiced ? 'Remove Invoice' : 'Mark Invoice'}
                </DropdownMenuItem>
              )}
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-2 text-xs md:text-sm">
          {getReportLocation() && (
            <p className="text-muted-foreground line-clamp-1">{getReportLocation()}</p>
          )}
          <p className="text-muted-foreground" title={dateInfo?.full}>
            {dateInfo ? dateInfo.relative : 'No date'}
          </p>
          {lastActivity && getReportStatus() !== 'completed' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-muted-foreground/70 text-[11px] cursor-help w-fit">
                  Edited {lastActivity}
                </p>
              </TooltipTrigger>
              <TooltipContent side="top">
                {report.updated_at ? format(new Date(report.updated_at), 'PPpp') : 'Unknown'}
              </TooltipContent>
            </Tooltip>
          )}
          <div className="flex items-center gap-2">
            <Avatar className="h-6 w-6">
              <AvatarImage src={getInspectorAvatar() || undefined} alt={getInspectorName()} />
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {getInspectorInitials()}
              </AvatarFallback>
            </Avatar>
            <span className="text-muted-foreground font-mono">
              {getInspectorName()}
            </span>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap pt-2">
            <Badge 
              variant={getReportStatus() === 'completed' ? 'default' : 'secondary'}
              className="text-xs"
            >
              {getReportStatus()}
            </Badge>
            
            {/* Universal Sync Status Badge */}
            {report.synced_at ? (
              <Badge variant="outline" className="gap-1 text-xs px-2 py-0.5 text-green-600 border-green-300">
                <Check className="w-3 h-3" />
                Synced
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 text-xs px-2 py-0.5">
                <Cloud className="w-3 h-3" />
                Local
              </Badge>
            )}
            
            {getStatusBadge && isInspection && getStatusBadge(report)}
          </div>
        </div>
      </CardContent>
      <SparkleContainer sparkles={sparkles} />
    </Card>
  );
}
