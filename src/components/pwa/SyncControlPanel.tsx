import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, CheckCircle2, XCircle, Cloud, AlertCircle } from 'lucide-react';
import { usePWA } from '@/hooks/usePWA';
import { useSyncProgress } from '@/hooks/useSyncProgress';
import confetti from 'canvas-confetti';
import { motion, AnimatePresence } from 'framer-motion';

export const SyncControlPanel = () => {
  const { isOnline, unsyncedCount, isSyncing, triggerSync, unsyncedPhotoCount } = usePWA();
  const { progress } = useSyncProgress();
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [syncComplete, setSyncComplete] = useState(false);

  const totalUnsynced = unsyncedCount + unsyncedPhotoCount;
  const shouldShowButton = isOnline && totalUnsynced > 0;

  const handleSync = async () => {
    setShowProgressModal(true);
    setSyncComplete(false);
    
    try {
      await triggerSync();
      setSyncComplete(true);
      
      // Trigger confetti
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
      
      // Auto-close after 2 seconds
      setTimeout(() => {
        setShowProgressModal(false);
        setSyncComplete(false);
      }, 2000);
    } catch (error) {
      // Error is handled by the hook
      setSyncComplete(false);
    }
  };

  if (!shouldShowButton) return null;

  const progressPercentage = progress.total > 0 
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
      >
        <Button
          onClick={handleSync}
          disabled={isSyncing || !isOnline}
          className="relative gradient-button"
          size="lg"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
          Sync Now
          {totalUnsynced > 0 && (
            <Badge 
              variant="secondary" 
              className="ml-2 bg-white/20 text-white hover:bg-white/30"
            >
              {totalUnsynced}
            </Badge>
          )}
        </Button>
      </motion.div>

      <Dialog open={showProgressModal} onOpenChange={setShowProgressModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {syncComplete ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  Sync Complete
                </>
              ) : progress.errors.length > 0 ? (
                <>
                  <AlertCircle className="h-5 w-5 text-yellow-600" />
                  Sync Completed with Errors
                </>
              ) : (
                <>
                  <Cloud className="h-5 w-5 animate-pulse" />
                  Syncing Data...
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {syncComplete 
                ? 'All your data has been synchronized successfully!'
                : 'Please wait while we sync your data to the cloud.'
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <AnimatePresence mode="wait">
              {!syncComplete && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  {/* Progress Bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-medium">{progressPercentage}%</span>
                    </div>
                    <Progress value={progressPercentage} className="h-2" />
                  </div>

                  {/* Current Operation */}
                  {progress.currentItem && (
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Current Operation</p>
                      <p className="text-sm text-muted-foreground">
                        {progress.currentItem}
                      </p>
                    </div>
                  )}

                  {/* Phase Indicator */}
                  <div className="flex gap-2">
                    <Badge variant={progress.phase === 'inspections' ? 'default' : 'outline'}>
                      Inspections {progress.phase === 'inspections' && `(${progress.current}/${progress.total})`}
                    </Badge>
                    <Badge variant={progress.phase === 'photos' ? 'default' : 'outline'}>
                      Photos {progress.phase === 'photos' && `(${progress.current}/${progress.total})`}
                    </Badge>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Errors Section */}
            {progress.errors.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-2"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-yellow-600">
                  <XCircle className="h-4 w-4" />
                  Failed Items ({progress.errors.length})
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {progress.errors.map((error, index) => (
                    <div
                      key={index}
                      className="text-xs bg-yellow-50 dark:bg-yellow-950/20 p-2 rounded border border-yellow-200 dark:border-yellow-800"
                    >
                      <p className="font-medium">{error.id}</p>
                      <p className="text-muted-foreground">{error.error}</p>
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSync}
                  className="w-full"
                >
                  <RefreshCw className="h-3 w-3 mr-2" />
                  Retry Failed Items
                </Button>
              </motion.div>
            )}

            {/* Success State */}
            {syncComplete && (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-center py-4"
              >
                <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {progress.total} item(s) synchronized
                </p>
              </motion.div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
