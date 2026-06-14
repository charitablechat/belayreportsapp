import { cn } from "@/lib/utils";
import { FileText, AlertTriangle, CheckCircle2, Clock, HardDrive } from "lucide-react";
import { useStoragePressure } from "@/hooks/useStoragePressure";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface DashboardStatsBarProps {
  total: number;
  drafts: number;
  overdue: number;
  completed: number;
  onFilterClick?: (filter: 'all' | 'drafts' | 'overdue' | 'completed') => void;
  activeFilter?: string | null;
  dataValidated?: boolean;
}

const stats = [
  { key: 'all' as const, label: 'Total', icon: FileText, colorClass: 'text-primary', borderLeftColorClass: 'border-l-primary' },
  { key: 'drafts' as const, label: 'Drafts', icon: Clock, colorClass: 'text-amber-600 dark:text-amber-400', borderLeftColorClass: 'border-l-amber-500 dark:border-l-amber-400' },
  { key: 'overdue' as const, label: 'Overdue', icon: AlertTriangle, colorClass: 'text-destructive', borderLeftColorClass: 'border-l-destructive' },
  { key: 'completed' as const, label: 'Complete', icon: CheckCircle2, colorClass: 'text-green-600 dark:text-green-400', borderLeftColorClass: 'border-l-green-500 dark:border-l-green-400' },
];

export function DashboardStatsBar({ total, drafts, overdue, completed, onFilterClick, activeFilter, dataValidated = true }: DashboardStatsBarProps) {
  const values = { all: total, drafts, overdue, completed };
  const { estimate, tierColor, formattedUsage, formattedQuota } = useStoragePressure();
  const showSkeleton = !dataValidated;

  return (
    <div className="space-y-1 mb-4">
      <div className="grid grid-cols-4 gap-2">
        {stats.map(({ key, label, icon: Icon, colorClass, borderLeftColorClass }) => {
          const isActive = activeFilter === key;
          return (
            <button
              key={key}
              onClick={() => onFilterClick?.(key)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl p-2.5 transition-all text-center border-l-4",
              borderLeftColorClass,
              "hover:-translate-y-0.5 hover:shadow-md",
              isActive
                ? "backdrop-blur-md bg-primary/20 border border-primary/60 ring-2 ring-primary/40 shadow-[0_4px_20px_-4px_hsl(var(--primary)/0.45)]"
                : "glass-stat-button dark:hover:bg-white/[0.15]"
            )}
            >
              <div className="flex items-center gap-1.5">
                <Icon className={cn("w-3.5 h-3.5", colorClass)} />
                {showSkeleton ? (
                  <span className="inline-block w-5 h-5 rounded bg-muted animate-pulse" />
                ) : (
                  <span className="text-lg font-bold tabular-nums leading-none text-white">
                    {values[key]}
                  </span>
                )}
              </div>
              <span className="text-[11px] font-medium text-white/70 uppercase tracking-[0.08em]">
                {label}
              </span>
            </button>
          );
        })}
      </div>
      {estimate && estimate.tier >= 1 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              "flex items-center justify-center gap-1.5 text-[11px] font-medium py-1 rounded-md",
              estimate.tier >= 3 ? "bg-destructive/10" : estimate.tier >= 2 ? "bg-orange-500/10" : "bg-amber-500/10",
              tierColor
            )}>
              <HardDrive className="w-3 h-3" />
              <span>Storage: {formattedUsage} / {formattedQuota} ({(estimate.usagePercent * 100).toFixed(0)}%)</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>Device storage usage. Old synced reports are automatically cleared to free space.</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
