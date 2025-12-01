import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";
import { triggerHaptic } from "@/lib/haptics";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ActionItem {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "success";
}

interface FloatingActionButtonProps {
  primaryAction: ActionItem & { loading?: boolean };
  secondaryActions?: ActionItem[];
  hasUnsavedChanges?: boolean;
  className?: string;
}

export function FloatingActionButton({
  primaryAction,
  secondaryActions = [],
  hasUnsavedChanges = false,
  className,
}: FloatingActionButtonProps) {
  const isMobile = useIsMobile();
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isMobile) return null;

  const handlePrimaryClick = () => {
    triggerHaptic("light");
    primaryAction.onClick();
  };

  const handleToggleExpand = () => {
    if (secondaryActions.length === 0) {
      handlePrimaryClick();
      return;
    }
    triggerHaptic("light");
    setIsExpanded(!isExpanded);
  };

  const handleSecondaryClick = (action: ActionItem) => {
    triggerHaptic("light");
    action.onClick();
    setIsExpanded(false);
  };

  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsExpanded(false)}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
          />
        )}
      </AnimatePresence>

      {/* FAB Container */}
      <div className={cn("fixed bottom-20 right-4 z-50", className)}>
        {/* Secondary Actions Menu */}
        <AnimatePresence>
          {isExpanded && secondaryActions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-16 right-0 flex flex-col gap-2 mb-2"
            >
              {secondaryActions.map((action, index) => (
                <motion.button
                  key={index}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => handleSecondaryClick(action)}
                  disabled={action.disabled}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-full shadow-lg",
                    "bg-card text-card-foreground",
                    "hover:bg-accent hover:text-accent-foreground",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    "transition-colors min-w-[140px]",
                    action.variant === "success" && "bg-green-500 text-white hover:bg-green-600"
                  )}
                >
                  <span className="flex-shrink-0">{action.icon}</span>
                  <span className="text-sm font-medium whitespace-nowrap">
                    {action.label}
                  </span>
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Primary FAB Button */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={handleToggleExpand}
          disabled={primaryAction.disabled || primaryAction.loading}
          className={cn(
            "relative h-14 w-14 rounded-full shadow-lg",
            "bg-primary text-primary-foreground",
            "hover:bg-primary/90",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "flex items-center justify-center",
            "transition-colors",
            hasUnsavedChanges && !primaryAction.loading && "animate-pulse"
          )}
        >
          {primaryAction.loading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <motion.div
              animate={{ rotate: isExpanded ? 45 : 0 }}
              transition={{ duration: 0.2 }}
            >
              {primaryAction.icon}
            </motion.div>
          )}

          {/* Unsaved Changes Indicator */}
          {hasUnsavedChanges && !primaryAction.loading && (
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-destructive border-2 border-background" />
          )}
        </motion.button>
      </div>
    </>
  );
}
