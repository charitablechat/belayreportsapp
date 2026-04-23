import { evaluatePassword } from "@/lib/password-strength";
import { cn } from "@/lib/utils";

interface PasswordStrengthMeterProps {
  password: string;
  className?: string;
}

/**
 * M14: Visual strength meter shown below password inputs.
 * Uses semantic tokens; no hardcoded colors.
 */
export function PasswordStrengthMeter({ password, className }: PasswordStrengthMeterProps) {
  if (!password) return null;
  const { score, label, reason, acceptable } = evaluatePassword(password);

  // Map score to semantic background color via opacity-modulated primary/destructive.
  const segmentClasses = (idx: number) => {
    const filled = idx <= score;
    if (!filled) return "bg-muted";
    if (score <= 1) return "bg-destructive";
    if (score === 2) return "bg-amber-500";
    return "bg-primary";
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={cn("h-1 flex-1 rounded-full transition-colors", segmentClasses(i))} />
        ))}
      </div>
      <p
        className={cn(
          "text-xs",
          acceptable ? "text-muted-foreground" : "text-destructive"
        )}
        aria-live="polite"
      >
        {label}
        {reason ? ` — ${reason}` : ""}
      </p>
    </div>
  );
}
