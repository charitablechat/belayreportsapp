import { cn } from "@/lib/utils";
import { FileText, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

interface DashboardStatsBarProps {
  total: number;
  drafts: number;
  overdue: number;
  completed: number;
  onFilterClick?: (filter: 'all' | 'drafts' | 'overdue' | 'completed') => void;
  activeFilter?: string | null;
}

const stats = [
  { key: 'all' as const, label: 'Total', icon: FileText, colorClass: 'text-primary' },
  { key: 'drafts' as const, label: 'Drafts', icon: Clock, colorClass: 'text-amber-600 dark:text-amber-400' },
  { key: 'overdue' as const, label: 'Overdue', icon: AlertTriangle, colorClass: 'text-destructive' },
  { key: 'completed' as const, label: 'Complete', icon: CheckCircle2, colorClass: 'text-green-600 dark:text-green-400' },
];

export function DashboardStatsBar({ total, drafts, overdue, completed, onFilterClick, activeFilter }: DashboardStatsBarProps) {
  const values = { all: total, drafts, overdue, completed };

  return (
    <div className="grid grid-cols-4 gap-2 mb-4">
      {stats.map(({ key, label, icon: Icon, colorClass }) => {
        const isActive = activeFilter === key;
        return (
          <button
            key={key}
            onClick={() => onFilterClick?.(key)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border p-2.5 transition-all text-center",
              "hover:bg-accent/50 hover:border-primary/30",
              isActive && "bg-primary/10 border-primary/40 ring-1 ring-primary/15",
              !isActive && "bg-card border-border"
            )}
          >
            <div className="flex items-center gap-1.5">
              <Icon className={cn("w-3.5 h-3.5", colorClass)} />
              <span className={cn("text-lg font-bold tabular-nums leading-none", colorClass)}>
                {values[key]}
              </span>
            </div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
