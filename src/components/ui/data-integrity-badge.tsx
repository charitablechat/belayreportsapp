/**
 * Data Integrity Badge — Glassmorphism status indicator
 * 
 * Compact badge showing the current data persistence state
 * using the frosted glass aesthetic with theme-aware status colors.
 */

import { cn } from "@/lib/utils";
import { Shield, HardDrive, Cloud, Loader2 } from "lucide-react";

export type IntegrityStatus = 'hard-saved' | 'pending' | 'synced' | 'shield-active';

interface DataIntegrityBadgeProps {
  status: IntegrityStatus;
  versionNumber?: number;
  fieldCount?: number;
  className?: string;
}

const statusConfig: Record<IntegrityStatus, {
  label: string;
  icon: typeof Shield;
  borderClass: string;
  textClass: string;
}> = {
  'hard-saved': {
    label: 'HARD-SAVED',
    icon: HardDrive,
    borderClass: 'border-emerald-400/20',
    textClass: 'text-emerald-400',
  },
  'pending': {
    label: 'PENDING',
    icon: Loader2,
    borderClass: 'border-amber-400/20',
    textClass: 'text-amber-400',
  },
  'synced': {
    label: 'SYNCED',
    icon: Cloud,
    borderClass: 'border-sky-400/20',
    textClass: 'text-sky-400',
  },
  'shield-active': {
    label: 'SYNC SHIELD',
    icon: Shield,
    borderClass: 'border-emerald-400/30',
    textClass: 'text-emerald-400',
  },
};

export function DataIntegrityBadge({ status, versionNumber, fieldCount, className }: DataIntegrityBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  const isAnimated = status === 'pending';

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded',
        'bg-white/15 dark:bg-black/30 backdrop-blur-xl shadow-md shadow-black/5',
        'font-mono text-[10px] leading-none',
        'border shadow-sm',
        config.borderClass,
        config.textClass,
        className
      )}
    >
      <Icon className={cn('h-3 w-3', isAnimated && 'animate-spin')} />
      <span className="tracking-wider font-bold">{config.label}</span>
      {versionNumber !== undefined && (
        <span className="opacity-60">v{versionNumber}</span>
      )}
      {fieldCount !== undefined && (
        <span className="opacity-40">({fieldCount})</span>
      )}
    </div>
  );
}
