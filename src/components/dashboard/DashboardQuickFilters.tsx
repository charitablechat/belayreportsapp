import { cn } from "@/lib/utils";
import { User, CalendarDays, FileEdit, AlertTriangle } from "lucide-react";

interface QuickFilters {
  myCards: boolean;
  dueThisWeek: boolean;
  draftsOnly: boolean;
  needsAttention: boolean;
}

interface DashboardQuickFiltersProps {
  quickFilters: QuickFilters;
  onToggle: (key: keyof QuickFilters) => void;
  criticalCount: number;
  warningCount: number;
}

const chips: { key: keyof QuickFilters; label: string; icon: React.ElementType }[] = [
  { key: 'myCards', label: 'My Cards', icon: User },
  { key: 'dueThisWeek', label: 'Due This Week', icon: CalendarDays },
  { key: 'draftsOnly', label: 'Drafts Only', icon: FileEdit },
  { key: 'needsAttention', label: 'Needs Attention', icon: AlertTriangle },
];

export function DashboardQuickFilters({ quickFilters, onToggle, criticalCount, warningCount }: DashboardQuickFiltersProps) {
  const attentionCount = criticalCount + warningCount;

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(({ key, label, icon: Icon }) => {
        const active = quickFilters[key];
        const showBadge = key === 'needsAttention' && attentionCount > 0;
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
              active
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-background text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {showBadge && (
              <span className={cn(
                "ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none",
                active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-destructive text-destructive-foreground"
              )}>
                {attentionCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
