import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, Cloud } from "lucide-react";
import { differenceInDays } from "date-fns";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { triggerHaptic } from "@/lib/haptics";
import { getReportDate, getAssigneeName } from "@/lib/report-utils";

function getAvatarUrl(r: any, type: string): string | null {
  if (type === 'training') return r.trainer?.avatar_url || null;
  return r.inspector?.avatar_url || null;
}

function getDaysOpen(r: any): number {
  if (!r.created_at) return 0;
  return differenceInDays(new Date(), new Date(r.created_at));
}

function getDaysOpenColor(days: number, status: string): string {
  if (status === 'completed') return '';
  if (days > 5) return 'bg-red-200 dark:bg-red-900/40 text-red-900 dark:text-red-200';
  if (days > 3) return 'bg-yellow-50 dark:bg-yellow-950/30 text-yellow-900 dark:text-yellow-200';
  return '';
}

export function ReportListView({ reports, type, onRowClick }: ReportListViewProps) {
  return (
    <div className="border rounded-md overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[180px]">Title</TableHead>
            <TableHead className="hidden md:table-cell">Location</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="hidden sm:table-cell">Assignee</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-center">Days</TableHead>
            <TableHead className="text-center">Sync</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.map((r) => {
            const days = getDaysOpen(r);
            const daysColor = getDaysOpenColor(days, r.status);
            const dateStr = getReportDate(r, type);
            const parsed = dateStr ? parseLocalDate(dateStr) : null;

            return (
              <TableRow
                key={r.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => {
                  triggerHaptic('light');
                  onRowClick(r);
                }}
              >
                <TableCell className="font-medium text-sm">{r.organization || 'Untitled'}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{r.location || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground font-mono">
                  {parsed ? format(parsed, "MMM d, yyyy") : '—'}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={getAvatarUrl(r, type) || undefined} />
                      <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                        {getAssigneeName(r, type).charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-muted-foreground">{getAssigneeName(r, type)}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={r.status === 'completed' ? 'default' : 'secondary'} className="text-xs">
                    {r.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  <span className={cn("px-2 py-0.5 rounded text-xs font-mono", daysColor)}>
                    {r.status === 'completed' ? '—' : days}
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  {r.synced_at ? (
                    <Check className="w-4 h-4 text-green-600 mx-auto" />
                  ) : (
                    <Cloud className="w-4 h-4 text-muted-foreground mx-auto" />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
