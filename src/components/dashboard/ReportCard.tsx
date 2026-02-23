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
import { format, differenceInDays } from "date-fns";
import { FileText, MoreVertical, Trash2, Download, Check, Cloud } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";
import { parseLocalDate } from "@/lib/date-utils";
import { triggerSuccessConfetti } from "@/lib/confetti";
import { cn } from "@/lib/utils";

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
}

export function ReportCard({ report, type, onDelete, onClick, getStatusBadge }: ReportCardProps) {
  const isInspection = type === 'inspection';
  const isDaily = type === 'daily';
  
  const getReportDate = () => {
    if (isInspection) return report.inspection_date;
    if (isDaily) return report.assessment_date;
    return report.training?.start_date || report.start_date;
  };

  const getReportOrganization = () => {
    if (isInspection) return report.organization;
    if (isDaily) return report.site;
    return report.training?.organization || report.organization;
  };

  const getReportLocation = () => {
    if (isInspection) return report.location;
    return null;
  };

  const getInspectorName = () => {
    // For training reports, try trainer profile first, then trainer_of_record field
    if (type === 'training') {
      const firstName = report.trainer?.first_name || '';
      const lastName = report.trainer?.last_name || '';
      const trainerName = `${firstName} ${lastName}`.trim();
      return trainerName || report.trainer_of_record || 'Unknown';
    }
    
    // For daily assessments, try inspector profile first, then trainer_of_record field
    if (type === 'daily') {
      const firstName = report.inspector?.first_name || '';
      const lastName = report.inspector?.last_name || '';
      const inspectorName = `${firstName} ${lastName}`.trim();
      return inspectorName || report.trainer_of_record || 'Unknown';
    }
    
    // For inspections, use inspector profile
    const firstName = report.inspector?.first_name || '';
    const lastName = report.inspector?.last_name || '';
    return `${firstName} ${lastName}`.trim() || 'Unknown';
  };

  const getInspectorAvatar = () => {
    if (type === 'training') {
      return report.trainer?.avatar_url || null;
    }
    return report.inspector?.avatar_url || null;
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
    critical: 'bg-red-200 dark:bg-red-900/40 border-red-400 dark:border-red-800',
    warning: 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-300 dark:border-yellow-700',
    completed: 'border-l-4 border-l-green-500',
    default: '',
  };

  return (
    <Card 
      className={cn(
        "relative overflow-visible cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/50 active:scale-[0.99] active:shadow-md group",
        ageStateClasses[ageState]
      )}
      onClick={() => {
        triggerHaptic('light');
        if (getReportStatus() === 'completed') {
          triggerSuccessConfetti();
        }
        onClick(report);
      }}
    >
      {getReportStatus() === 'completed' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <span className="text-green-500/20 text-4xl md:text-5xl font-bold tracking-wider rotate-[-25deg] select-none whitespace-nowrap">
            COMPLETED
          </span>
        </div>
      )}
      <CardContent className="p-4 md:p-6">
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
          <p className="text-muted-foreground">
            Date: {parseLocalDate(getReportDate()) ? format(parseLocalDate(getReportDate())!, "PPP") : 'No date'}
          </p>
          <div className="flex items-center gap-2">
            <Avatar className="h-6 w-6">
              <AvatarImage src={getInspectorAvatar() || undefined} alt={getInspectorName()} />
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {getInspectorInitials()}
              </AvatarFallback>
            </Avatar>
            <span className="text-muted-foreground">
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
    </Card>
  );
}
