import { motion, AnimatePresence } from "framer-motion";
import { ReactNode } from "react";

interface AnimatedListItemProps {
  children: ReactNode;
  itemKey: string;
  isNew?: boolean;
  className?: string;
  /** PERFORMANCE: Pass isMobile from parent to avoid hook call per item */
  isMobile?: boolean;
}

export function AnimatedListItem({ 
  children, 
  itemKey, 
  isNew = false,
  className = "",
  isMobile = false
}: AnimatedListItemProps) {
  // PERFORMANCE: Skip mount animations on mobile unless item is explicitly new
  const skipInitialAnimation = isMobile && !isNew;
  
  return (
    <motion.div
      key={itemKey}
      initial={skipInitialAnimation ? false : { opacity: 0, y: -10, scale: 0.98 }}
      animate={{ 
        opacity: 1, 
        y: 0, 
        scale: 1,
        backgroundColor: isNew ? ["hsl(var(--primary) / 0.15)", "hsl(var(--primary) / 0)"] : "transparent"
      }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ 
        duration: skipInitialAnimation ? 0 : 0.3,
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
  /** PERFORMANCE: Pass isMobile from parent to avoid hook call per item */
  isMobile?: boolean;
}

export function AnimatedTableRow({ 
  children, 
  itemKey, 
  isNew = false,
  className = "",
  isMobile = false
}: AnimatedTableRowProps) {
  // PERFORMANCE: Skip mount animations on mobile unless item is explicitly new
  const skipInitialAnimation = isMobile && !isNew;
  
  return (
    <motion.tr
      key={itemKey}
      initial={skipInitialAnimation ? false : { opacity: 0, backgroundColor: "hsl(var(--primary) / 0.2)" }}
      animate={{ 
        opacity: 1,
        backgroundColor: "transparent"
      }}
      transition={{ 
        opacity: { duration: skipInitialAnimation ? 0 : 0.2 },
        backgroundColor: { duration: skipInitialAnimation ? 0 : 1.2, ease: "easeOut" }
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
