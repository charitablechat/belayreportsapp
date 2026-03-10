import { useState, useEffect, useCallback } from 'react';
import { getUnuploadedPhotos } from '@/lib/offline-storage';
import { getUserWithCache } from '@/lib/cached-auth';

export interface UnsyncedPhotosStatus {
  unsyncedPhotoCount: number;
  photosByInspection: Record<string, number>;
}

export const useUnsyncedPhotos = () => {
  const [status, setStatus] = useState<UnsyncedPhotosStatus>({
    unsyncedPhotoCount: 0,
    photosByInspection: {},
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
        });
        return;
      }
      
      const unuploaded = await getUnuploadedPhotos(user.id);
      
      // Group by inspection
      const byInspection: Record<string, number> = {};
      unuploaded.forEach(photo => {
        byInspection[photo.inspectionId] = (byInspection[photo.inspectionId] || 0) + 1;
      });

      setStatus({
        unsyncedPhotoCount: unuploaded.length,
        photosByInspection: byInspection,
      });

      if (import.meta.env.DEV) {
        console.log('[Unsynced Photos] Count updated:', unuploaded.length);
      }
    } catch (error) {
      console.error('[Unsynced Photos] Error getting count:', error);
    }
  }, []);

  // Update on mount and every 30 seconds
  useEffect(() => {
    updatePhotoCount();
    const interval = setInterval(updatePhotoCount, 30000);
    return () => clearInterval(interval);
  }, [updatePhotoCount]);

  return {
    ...status,
    updatePhotoCount,
  };
};
