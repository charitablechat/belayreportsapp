import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { CheckCircle } from "lucide-react";

interface FormProgressBarProps {
  sections: {
    id: string;
    label: string;
    isComplete: boolean;
  }[];
  currentSection?: string;
  className?: string;
}

export function FormProgressBar({
  sections,
  currentSection,
  className,
}: FormProgressBarProps) {
  const completedCount = sections.filter((s) => s.isComplete).length;
  const progress = (completedCount / sections.length) * 100;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Progress bar */}
      <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
        <motion.div
          className="absolute inset-y-0 left-0 bg-primary rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>

      {/* Section indicators - hidden on mobile, shown on larger screens */}
      <div className="hidden sm:flex items-center justify-between gap-1">
        {sections.map((section, index) => (
          <div
            key={section.id}
            className={cn(
              "flex items-center gap-1.5 text-xs transition-colors",
              section.isComplete
                ? "text-primary"
                : currentSection === section.id
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            {section.isComplete ? (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              >
                <CheckCircle className="w-3.5 h-3.5" />
              </motion.div>
            ) : (
              <span
                className={cn(
                  "w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[10px] font-medium",
                  currentSection === section.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground"
                )}
              >
                {index + 1}
              </span>
            )}
            <span className="hidden md:inline truncate max-w-[80px]">
              {section.label}
            </span>
          </div>
        ))}
      </div>

      {/* Mobile: Just show count */}
      <div className="flex sm:hidden items-center justify-between text-xs text-muted-foreground">
        <span>Progress</span>
        <span className="font-medium text-foreground">
          {completedCount} of {sections.length} complete
        </span>
      </div>
    </div>
  );
}
