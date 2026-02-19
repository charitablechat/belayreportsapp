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
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1a1a1a] border border-[#32CD32]/30 font-mono text-xs select-none">
      {/* REC indicator */}
      <span className="flex items-center gap-1">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            recording
              ? "bg-[#32CD32] animate-[terminal-blink_1s_step-end_infinite]"
              : "bg-[#32CD32]/30"
          }`}
        />
        <span
          className={`text-[10px] font-semibold tracking-wider ${
            recording ? "text-[#32CD32]" : "text-[#32CD32]/40"
          }`}
        >
          REC
        </span>
      </span>

      {/* Time display */}
      <span className="text-[#32CD32] tabular-nums">{formatTime(elapsedSeconds)}</span>

      {/* Blinking cursor */}
      {!isReadOnly && (
        <span className="text-[#32CD32] animate-[terminal-blink_1s_step-end_infinite]">_</span>
      )}
    </div>
  );
});
