import { useState, useEffect } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { WifiOff, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePWA } from '@/hooks/usePWA';

export const OfflineCapabilitiesBanner = () => {
  const { isOnline } = usePWA();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDismissed, setIsDismissed] = useState(false);

  // Reset state when going offline
  useEffect(() => {
    if (!isOnline) {
      const wasDismissed = localStorage.getItem('offline-banner-dismissed') === 'true';
      setIsDismissed(wasDismissed);
      if (!wasDismissed) {
        setIsExpanded(true);
      }
    }
  }, [isOnline]);

  const handleDismiss = () => {
    setIsDismissed(true);
    localStorage.setItem('offline-banner-dismissed', 'true');
  };

  const handleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  // Don't show if online
  if (isOnline || isDismissed) return null;

  const capabilities = [
    { label: 'View existing data', available: true },
    { label: 'Edit inspections', available: true },
    { label: 'Capture photos', available: true },
    { label: 'Create new inspections', available: true },
    { label: 'Complete inspections', available: false },
  ];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="mb-4"
      >
        <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
          <WifiOff className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <AlertTitle className="text-blue-900 dark:text-blue-100 mb-0">
                You're Working Offline
              </AlertTitle>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExpand}
                  className="h-6 px-2 text-blue-700 dark:text-blue-300"
                >
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDismiss}
                  className="h-6 px-2 text-blue-700 dark:text-blue-300"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <AlertDescription className="text-blue-800 dark:text-blue-200 mt-2">
                    Your work will be saved and synced when you're back online.
                  </AlertDescription>
                  
                  <div className="mt-3 space-y-2">
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      What you can do offline:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {capabilities.map((cap) => (
                        <div
                          key={cap.label}
                          className="flex items-center gap-2 text-sm"
                        >
                          {cap.available ? (
                            <Check className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                          ) : (
                            <X className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                          )}
                          <span
                            className={
                              cap.available
                                ? 'text-blue-900 dark:text-blue-100'
                                : 'text-blue-700 dark:text-blue-300 opacity-75'
                            }
                          >
                            {cap.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Alert>
      </motion.div>
    </AnimatePresence>
  );
};
