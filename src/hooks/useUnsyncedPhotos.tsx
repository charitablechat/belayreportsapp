import { useState, useEffect, useCallback } from 'react';
import { getUnuploadedPhotos } from '@/lib/offline-storage';

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
      const unuploaded = await getUnuploadedPhotos();
      
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
