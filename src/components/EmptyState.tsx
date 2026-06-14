import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FileText, ClipboardList, GraduationCap, Briefcase, LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon: Icon = FileText,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn(
        "flex flex-col items-center justify-center py-12 px-4 text-center",
        className
      )}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        className="relative mb-6"
      >
        {/* Background glow */}
        <div className="absolute inset-0 bg-primary/10 rounded-full blur-xl scale-150" />
        
        {/* Icon container */}
        <div className="relative bg-muted rounded-full p-6">
          <Icon className="w-12 h-12 text-muted-foreground" />
        </div>
      </motion.div>

      <motion.h3
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.3 }}
        className="text-lg font-semibold text-foreground mb-2"
      >
        {title}
      </motion.h3>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.3 }}
        className="text-muted-foreground text-sm max-w-xs mb-6"
      >
        {description}
      </motion.p>

      {action && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.3 }}
        >
          <Button onClick={action.onClick} className="gap-2">
            {action.label}
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}

// Pre-configured empty states for common use cases
export function InspectionsEmptyState({ onAction }: { onAction: () => void }) {
  return (
    <EmptyState
      icon={FileText}
      title="No inspections yet"
      description="Create your first inspection to get started with documenting your findings."
      action={{
        label: "New Inspection",
        onClick: onAction,
      }}
    />
  );
}

export function TrainingsEmptyState({ onAction }: { onAction: () => void }) {
  return (
    <EmptyState
      icon={GraduationCap}
      title="No training sessions"
      description="Start documenting training sessions to track progress and certifications."
      action={{
        label: "New Training",
        onClick: onAction,
      }}
    />
  );
}

export function DailyAssessmentsEmptyState({ onAction }: { onAction: () => void }) {
  return (
    <EmptyState
      icon={ClipboardList}
      title="No daily assessments"
      description="Begin your daily assessment routine to ensure safety and compliance."
      action={{
        label: "New Assessment",
        onClick: onAction,
      }}
    />
  );
}

export function JCFsEmptyState({ onAction }: { onAction: () => void }) {
  return (
    <EmptyState
      icon={Briefcase}
      title="No job completion forms"
      description="Create a JCF to document completed work and hand-off details."
      action={{
        label: "New JCF",
        onClick: onAction,
      }}
    />
  );
}
