import { useEffect, useState, useCallback } from 'react';
import {
  onRemoteDeletedConflict,
  type RemoteDeletedConflictPayload,
} from '@/lib/sync-events';
import {
  getQuarantinedRecords,
  type QuarantinedRecord,
} from '@/lib/offline-storage';

/**
 * C9: Surfaces locally-quarantined records (remote was soft-deleted while
 * the device had unsynced edits). Subscribes to the live event bus AND
 * scans IDB on mount so the dialog re-appears across reloads / offline
 * sessions until the user resolves it.
 */
export function useRemoteDeletedConflicts() {
  const [conflicts, setConflicts] = useState<QuarantinedRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await getQuarantinedRecords();
      setConflicts(list);
    } catch (err) {
      console.error('[useRemoteDeletedConflicts] refresh failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const unsubscribe = onRemoteDeletedConflict((_p: RemoteDeletedConflictPayload) => {
      // Re-scan IDB so the new entry shows up immediately.
      void refresh();
    });

    // Window-event fallback (non-React listeners can also retrigger).
    const handleWin = () => void refresh();
    window.addEventListener('sync-remote-deleted-conflict', handleWin as EventListener);

    return () => {
      unsubscribe();
      window.removeEventListener('sync-remote-deleted-conflict', handleWin as EventListener);
    };
  }, [refresh]);

  return { conflicts, loading, refresh };
}
