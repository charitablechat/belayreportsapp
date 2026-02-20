import { memo } from "react";

interface ActiveTimerDisplayProps {
  elapsedSeconds: number;
  isActive: boolean;
  isPaused: boolean;
  isReadOnly?: boolean;
}

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const ActiveTimerDisplay = memo(function ActiveTimerDisplay({
  elapsedSeconds,
  isActive,
  isPaused,
  isReadOnly = false,
}: ActiveTimerDisplayProps) {
  const recording = isActive && !isPaused && !isReadOnly;

  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 dark:bg-black/30 backdrop-blur-xl border border-white/20 shadow-md shadow-black/5 font-mono text-xs select-none">
      {/* REC indicator */}
      <span className="flex items-center gap-1">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            recording
              ? "bg-emerald-400 animate-pulse-soft"
              : "bg-muted-foreground/30"
          }`}
        />
        <span
          className={`text-[10px] font-semibold tracking-wider ${
            recording ? "text-emerald-400" : "text-muted-foreground/40"
          }`}
        >
          REC
        </span>
      </span>

      {/* Time display */}
      <span className="text-foreground/80 tabular-nums">{formatTime(elapsedSeconds)}</span>
    </div>
  );
});
