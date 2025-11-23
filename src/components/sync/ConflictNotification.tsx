import { useEffect } from 'react';
import { useConflicts } from '@/hooks/useConflicts';
import { toast } from 'sonner';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ConflictNotificationProps {
  onViewConflicts: () => void;
}

export const ConflictNotification = ({ onViewConflicts }: ConflictNotificationProps) => {
  const { conflicts, conflictCount } = useConflicts();

  useEffect(() => {
    if (conflictCount > 0) {
      // Show toast notification when conflicts are detected
      toast.error(
        `Sync Conflict${conflictCount > 1 ? 's' : ''} Detected`,
        {
          description: `${conflictCount} inspection${conflictCount > 1 ? 's have' : ' has'} conflicting versions. Please resolve to continue syncing.`,
          icon: <AlertCircle className="w-5 h-5" />,
          duration: 60000,
          action: {
            label: 'Resolve',
            onClick: onViewConflicts,
          },
        }
      );
    }
  }, [conflictCount, onViewConflicts]);

  return null; // This is a notification-only component
};
