import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { FileText, MoreVertical, Trash2, Download, Check, RefreshCw, Cloud } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";

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
    const firstName = report.inspector?.first_name || report.training?.trainer?.first_name || report.trainer?.first_name || '';
    const lastName = report.inspector?.last_name || report.training?.trainer?.last_name || report.trainer?.last_name || '';
    return `${firstName} ${lastName}`.trim() || 'Unknown';
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

  return (
    <Card 
      className="relative overflow-hidden cursor-pointer hover:shadow-lg transition-all hover:border-primary/50 group"
      onClick={() => {
        triggerHaptic('light');
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
            Date: {format(new Date(getReportDate()), "PPP")}
          </p>
          <p className="text-muted-foreground">
            Inspector: {getInspectorName()}
          </p>
          
          <div className="flex items-center gap-2 flex-wrap pt-2">
            <Badge 
              variant={getReportStatus() === 'completed' ? 'default' : 'secondary'}
              className="text-xs"
            >
              {getReportStatus()}
            </Badge>
            
            {getStatusBadge && isInspection && getStatusBadge(report)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
