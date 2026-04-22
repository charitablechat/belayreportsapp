import { useState, useEffect, useCallback } from 'react';
import { getUnuploadedPhotos, getDeadLetterPhotos } from '@/lib/offline-storage';
import { getUserWithCache } from '@/lib/cached-auth';

export interface UnsyncedPhotosStatus {
  unsyncedPhotoCount: number;
  photosByInspection: Record<string, number>;
  deadLetterCount: number;
}

const SAFETY_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export const useUnsyncedPhotos = () => {
  const [status, setStatus] = useState<UnsyncedPhotosStatus>({
    unsyncedPhotoCount: 0,
    photosByInspection: {},
    deadLetterCount: 0,
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
        });
        return;
      }
      
      const [unuploaded, deadLetter] = await Promise.all([
        getUnuploadedPhotos(user.id),
        getDeadLetterPhotos(),
      ]);
      
      // Group by inspection
      const byInspection: Record<string, number> = {};
      unuploaded.forEach(photo => {
        byInspection[photo.inspectionId] = (byInspection[photo.inspectionId] || 0) + 1;
      });

      setStatus({
        unsyncedPhotoCount: unuploaded.length,
        photosByInspection: byInspection,
        deadLetterCount: deadLetter.length,
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
