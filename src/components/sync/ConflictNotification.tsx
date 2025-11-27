import { useEffect } from 'react';
import { useConflicts } from '@/hooks/useConflicts';

interface ConflictNotificationProps {
  onViewConflicts: () => void;
}

export const ConflictNotification = ({ onViewConflicts }: ConflictNotificationProps) => {
  const { conflicts, conflictCount } = useConflicts();

  useEffect(() => {
    if (conflictCount > 0 && import.meta.env.DEV) {
      console.log(`[Conflict Notification] ${conflictCount} sync conflict${conflictCount > 1 ? 's' : ''} detected`);
    }
  }, [conflictCount]);

  return null; // This is a notification-only component
};
