import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getUnuploadedPhotos,
  getDeadLetterPhotos,
  isIdbReadFailure,
} from '@/lib/offline-storage';
import { getUserWithCache } from '@/lib/cached-auth';

export interface DeadLetterPhotoInfo {
  id: string;
  inspectionId: string;
  fileName: string;
  retryCount: number;
  lastError: string | null;
  lastErrorAt: number | null;
  section?: string;
}

export interface UnsyncedPhotosStatus {
  unsyncedPhotoCount: number;
  photosByInspection: Record<string, number>;
  deadLetterCount: number;
  /** S22: Per-photo dead-letter info for the diagnostics UI. */
  deadLetterPhotos: DeadLetterPhotoInfo[];
  /**
   * S11: Set when an IDB read failure prevents us from getting a fresh photo
   * count. Last-known counts are preserved (don't zero the badge) and this
   * message bubbles up via PWAContextType.syncError.
   */
  idbReadError: string | null;
}

const SAFETY_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export const useUnsyncedPhotos = () => {
  const [status, setStatus] = useState<UnsyncedPhotosStatus>({
    unsyncedPhotoCount: 0,
    photosByInspection: {},
    deadLetterCount: 0,
    deadLetterPhotos: [],
    idbReadError: null,
  });

  // Keep a ref of last-known counts so we can preserve them on a transient
  // IDB read failure instead of dropping the badge to 0.
  const lastKnownRef = useRef<{ count: number; byInspection: Record<string, number>; deadLetter: number; deadLetterPhotos: DeadLetterPhotoInfo[] }>({
    count: 0,
    byInspection: {},
    deadLetter: 0,
    deadLetterPhotos: [],
  });

  const updatePhotoCount = useCallback(async () => {
    try {
      // Get current user to filter photos - uses cached auth
      const user = await getUserWithCache();
      if (!user) {
        console.warn('[Unsynced Photos] No authenticated user');
        setStatus({
          unsyncedPhotoCount: 0,
          photosByInspection: {},
          deadLetterCount: 0,
          deadLetterPhotos: [],
          idbReadError: null,
        });
        return;
      }
      
      const [unuploadedResult, deadLetterResult] = await Promise.all([
        getUnuploadedPhotos(user.id),
        getDeadLetterPhotos(),
      ]);

      // S11: If the read failed, preserve the last-known counts and surface an
      // error rather than silently zeroing the badge.
      if (isIdbReadFailure(unuploadedResult)) {
        console.warn('[Unsynced Photos] IDB read failed for unuploaded photos:', unuploadedResult.error);
        setStatus({
          unsyncedPhotoCount: lastKnownRef.current.count,
          photosByInspection: lastKnownRef.current.byInspection,
          deadLetterCount: lastKnownRef.current.deadLetter,
          deadLetterPhotos: lastKnownRef.current.deadLetterPhotos,
          idbReadError: 'Local data unreadable — refreshing may help',
        });
        return;
      }

      const unuploaded = unuploadedResult;
      // getDeadLetterPhotos still uses the silent boundary; treat its absence as 0.
      const deadLetter = Array.isArray(deadLetterResult) ? deadLetterResult : [];
      
      // Group by inspection
      const byInspection: Record<string, number> = {};
      unuploaded.forEach(photo => {
        byInspection[photo.inspectionId] = (byInspection[photo.inspectionId] || 0) + 1;
      });

      // S22: Surface per-photo dead-letter info (id + lastError) for the diagnostics UI.
      const deadLetterPhotos: DeadLetterPhotoInfo[] = deadLetter.map((p: any) => ({
        id: p.id,
        inspectionId: p.inspectionId,
        fileName: p.fileName,
        retryCount: p.retryCount || 0,
        lastError: p.lastError ?? null,
        lastErrorAt: p.lastErrorAt ?? null,
        section: p.section,
      }));

      lastKnownRef.current = {
        count: unuploaded.length,
        byInspection,
        deadLetter: deadLetter.length,
        deadLetterPhotos,
      };

      setStatus({
        unsyncedPhotoCount: unuploaded.length,
        photosByInspection: byInspection,
        deadLetterCount: deadLetter.length,
        deadLetterPhotos,
        idbReadError: null,
      });

      if (import.meta.env.DEV) {
        console.log('[Unsynced Photos] Count updated:', unuploaded.length, 'dead-letter:', deadLetter.length);
      }
    } catch (error) {
      console.error('[Unsynced Photos] Error getting count:', error);
    }
  }, []);

  // Update on mount + listen to sync events + 5-min safety tick
  useEffect(() => {
    updatePhotoCount();
    
    const handleSyncUpdate = () => updatePhotoCount();
    window.addEventListener('sync-photos-updated', handleSyncUpdate);

    const intervalId = window.setInterval(() => {
      updatePhotoCount();
    }, SAFETY_REFRESH_MS);

    return () => {
      window.removeEventListener('sync-photos-updated', handleSyncUpdate);
      window.clearInterval(intervalId);
    };
  }, [updatePhotoCount]);

  return {
    ...status,
    updatePhotoCount,
  };
};
