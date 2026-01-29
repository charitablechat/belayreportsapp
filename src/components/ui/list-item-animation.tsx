import { motion, AnimatePresence } from "framer-motion";
import { ReactNode } from "react";

interface AnimatedListItemProps {
  children: ReactNode;
  itemKey: string;
  isNew?: boolean;
  className?: string;
}

export function AnimatedListItem({ 
  children, 
  itemKey, 
  isNew = false,
  className = "" 
}: AnimatedListItemProps) {
  return (
    <motion.div
      key={itemKey}
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ 
        opacity: 1, 
        y: 0, 
        scale: 1,
        backgroundColor: isNew ? ["hsl(var(--primary) / 0.15)", "hsl(var(--primary) / 0)"] : "transparent"
      }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ 
        duration: 0.3,
        ease: "easeOut",
        backgroundColor: { duration: 1.5, ease: "easeOut" }
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

interface AnimatedTableRowProps {
  children: ReactNode;
  itemKey: string;
  isNew?: boolean;
  className?: string;
}

export function AnimatedTableRow({ 
  children, 
  itemKey, 
  isNew = false,
  className = "" 
}: AnimatedTableRowProps) {
  return (
    <motion.tr
      key={itemKey}
      initial={{ opacity: 0, backgroundColor: "hsl(var(--primary) / 0.2)" }}
      animate={{ 
        opacity: 1,
        backgroundColor: "transparent"
      }}
      transition={{ 
        opacity: { duration: 0.2 },
        backgroundColor: { duration: 1.2, ease: "easeOut" }
      }}
      className={className}
    >
      {children}
    </motion.tr>
  );
}

export function AnimatedListContainer({ 
  children 
}: { 
  children: ReactNode 
}) {
  return (
    <AnimatePresence mode="popLayout">
      {children}
    </AnimatePresence>
  );
}
