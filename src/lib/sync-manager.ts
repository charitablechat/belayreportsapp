import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache } from "@/lib/cached-auth";
import { 
  getUnuploadedPhotos,
  markPhotoAsUploaded,
} from "./offline-storage";

/**
 * @deprecated Use syncAllInspectionsAtomic from atomic-sync-manager.ts instead
 * This function does not handle soft-deleted records correctly for regular users
 * due to RLS policies blocking SELECT on deleted records.
 */
export async function syncInspections(): Promise<never> {
  throw new Error(
    '[Sync Manager] BLOCKED: syncInspections() is deprecated and disabled. ' +
    'Use syncAllInspectionsAtomic() from atomic-sync-manager.ts instead. ' +
    'This function bypasses atomic sync integrity safeguards.'
  );
}

/**
 * @deprecated Use syncAllDailyAssessmentsAtomic from atomic-sync-manager.ts instead
 * This function does not handle soft-deleted records correctly for regular users.
 */
export async function syncDailyAssessments(): Promise<never> {
  throw new Error(
    '[Sync Manager] BLOCKED: syncDailyAssessments() is deprecated and disabled. ' +
    'Use syncAllDailyAssessmentsAtomic() from atomic-sync-manager.ts instead. ' +
    'This function bypasses atomic sync integrity safeguards.'
  );
}

/**
 * @deprecated Use syncAllTrainingsAtomic from atomic-sync-manager.ts instead
 * This function does not handle soft-deleted records correctly for regular users.
 */
export async function syncTrainings(): Promise<never> {
  throw new Error(
    '[Sync Manager] BLOCKED: syncTrainings() is deprecated and disabled. ' +
    'Use syncAllTrainingsAtomic() from atomic-sync-manager.ts instead. ' +
    'This function bypasses atomic sync integrity safeguards.'
  );
}

// Photo sync manager - still valid, not deprecated
export async function syncPhotos() {
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Offline - skipping photo sync');
    }
    return;
  }

  if (import.meta.env.DEV) {
    console.log('[Sync Manager] Starting photo sync...');
  }

  try {
    const unuploadedPhotos = await getUnuploadedPhotos();
    
    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Uploading photos:', unuploadedPhotos.length);
    }

    let successCount = 0;

    for (const photo of unuploadedPhotos) {
      try {
        const user = await getUserWithCache();
        if (!user) throw new Error("Not authenticated");

        const fileExt = photo.fileName.split('.').pop();
        const fileName = `${user.id}/${photo.inspectionId}/${Date.now()}.${fileExt}`;
        
        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('inspection-photos')
          .upload(fileName, photo.blob);

        if (uploadError) throw uploadError;

        // Save to database with file path (signed URLs generated on read)
        const { error: dbError } = await supabase
          .from('inspection_photos')
          .insert({
            inspection_id: photo.inspectionId,
            photo_url: fileName,
            photo_section: photo.section,
          });

        if (dbError) throw dbError;

        // Mark as uploaded and remove blob from local storage
        await markPhotoAsUploaded(photo.id, fileName);
        successCount++;

        if (import.meta.env.DEV) {
          console.log('[Sync Manager] Uploaded photo:', photo.id);
        }
      } catch (error) {
        console.error('[Sync Manager] Failed to upload photo:', photo.id, error);
        // Continue with other photos even if one fails
      }
    }

    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Photo sync completed:', successCount, 'photos');
    }
  } catch (error) {
    console.error('[Sync Manager] Photo sync error:', error);
  }
}

// NOTE: The duplicate "online" listener that was here has been removed (P1).
// All sync orchestration (including photo sync) is handled by useAutoSync.tsx
// which provides proper guards: cooldown, batch limits, syncInProgressRef.
