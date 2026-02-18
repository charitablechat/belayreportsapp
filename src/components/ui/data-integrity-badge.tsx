/**
 * Data Integrity Badge — Retro-Tech Terminal status indicator
 * 
 * Compact badge showing the current data persistence state
 * using the Matrix Green (#00FF41) on Deep Black (#0D0D0D) aesthetic.
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
  glowClass: string;
  textClass: string;
}> = {
  'hard-saved': {
    label: 'HARD-SAVED',
    icon: HardDrive,
    glowClass: 'shadow-[0_0_8px_hsl(120,100%,50%,0.3)] border-[hsl(120,100%,50%,0.3)]',
    textClass: 'text-[hsl(120,100%,56%)]',
  },
  'pending': {
    label: 'PENDING',
    icon: Loader2,
    glowClass: 'shadow-[0_0_8px_hsl(38,92%,50%,0.3)] border-[hsl(38,92%,50%,0.3)]',
    textClass: 'text-[hsl(38,92%,50%)]',
  },
  'synced': {
    label: 'SYNCED',
    icon: Cloud,
    glowClass: 'shadow-[0_0_8px_hsl(190,90%,50%,0.3)] border-[hsl(190,90%,50%,0.3)]',
    textClass: 'text-[hsl(190,90%,50%)]',
  },
  'shield-active': {
    label: 'SYNC SHIELD',
    icon: Shield,
    glowClass: 'shadow-[0_0_8px_hsl(120,100%,50%,0.3)] border-[hsl(120,100%,50%,0.5)]',
    textClass: 'text-[hsl(120,100%,56%)]',
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
        'bg-[hsl(0,0%,5%)] font-mono text-[10px] leading-none',
        'border crt-scanlines',
        config.glowClass,
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
