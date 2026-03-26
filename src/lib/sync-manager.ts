import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache } from "@/lib/cached-auth";
import { 
  getUnuploadedPhotos,
  markPhotoAsUploaded,
  incrementPhotoRetryCount,
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
const MAX_PHOTO_BATCH_SIZE = 10;
const MAX_PHOTO_RETRIES = 5;

export async function syncPhotos(): Promise<{ remaining: number }> {
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Offline - skipping photo sync');
    }
    return { remaining: 0 };
  }

  if (import.meta.env.DEV) {
    console.log('[Sync Manager] Starting photo sync...');
  }

  try {
    const unuploadedPhotos = await getUnuploadedPhotos();
    // Skip photos that have exceeded retry limit
    const eligiblePhotos = unuploadedPhotos.filter(p => (p.retryCount || 0) < MAX_PHOTO_RETRIES);
    const skippedCount = unuploadedPhotos.length - eligiblePhotos.length;
    const batch = eligiblePhotos.slice(0, MAX_PHOTO_BATCH_SIZE);
    const remaining = Math.max(0, eligiblePhotos.length - MAX_PHOTO_BATCH_SIZE);
    
    if (skippedCount > 0 && import.meta.env.DEV) {
      console.warn(`[Sync Manager] Skipping ${skippedCount} photos that exceeded ${MAX_PHOTO_RETRIES} retries`);
    }

    if (import.meta.env.DEV) {
      console.log(`[Sync Manager] Uploading photos: ${batch.length} of ${eligiblePhotos.length} (${remaining} remaining)`);
    }

    let successCount = 0;

    for (const photo of batch) {
      try {
        if (photo.inspectionId?.startsWith('temp-')) {
          if (import.meta.env.DEV) {
            console.warn('[Sync Manager] Skipping photo with temporary inspection ID:', photo.id);
          }
          continue;
        }

        // Guard: blob must exist (may have been nullified by a previous partial success)
        if (!photo.blob) {
          if (import.meta.env.DEV) {
            console.warn('[Sync Manager] Skipping photo with null blob (already uploaded?):', photo.id);
          }
          await markPhotoAsUploaded(photo.id, photo.photoUrl || photo.id);
          continue;
        }

        const user = await getUserWithCache();
        if (!user) throw new Error("Not authenticated");

        // Use per-photo metadata with backward-compatible defaults
        const bucket = photo.storageBucket || 'inspection-photos';
        const table = photo.tableName || 'inspection_photos';
        const fkColumn = photo.foreignKeyColumn || 'inspection_id';

        const fileExt = photo.fileName.split('.').pop();
        const fallbackFileName = `${user.id}/${photo.inspectionId}/${Date.now()}.${fileExt}`;
        const fileName = photo.photoUrl || fallbackFileName;
        
        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from(bucket as any)
          .upload(fileName, photo.blob, {
            contentType: photo.blob.type || 'image/jpeg',
            upsert: true,
          });

        if (uploadError) throw uploadError;

        // Deduplication guard: check if a DB row already exists for this photo_url
        const { data: existing } = await (supabase
          .from(table as any) as any)
          .select('id')
          .eq('photo_url', fileName)
          .eq(fkColumn, photo.inspectionId)
          .maybeSingle();

        if (!existing) {
          // Save to database with file path (signed URLs generated on read)
          const { error: dbError } = await (supabase
            .from(table as any) as any)
            .insert({
              [fkColumn]: photo.inspectionId,
              photo_url: fileName,
              photo_section: photo.section,
              caption: photo.caption || photo.section || 'Photo',
            });

          if (dbError) throw dbError;
        } else if (import.meta.env.DEV) {
          console.log('[Sync Manager] Skipped duplicate DB row for photo:', photo.id);
        }

        // Mark as uploaded and release blob from IndexedDB
        await markPhotoAsUploaded(photo.id, fileName);
        successCount++;

        if (import.meta.env.DEV) {
          console.log('[Sync Manager] Uploaded photo:', photo.id);
        }
      } catch (error) {
        console.error('[Sync Manager] Failed to upload photo:', photo.id, error);
        // Increment retry counter so we eventually stop retrying broken photos
        await incrementPhotoRetryCount(photo.id);
      }
    }

    if (import.meta.env.DEV) {
      console.log(`[Sync Manager] Photo sync completed: ${successCount} photos, ${remaining} remaining`);
    }
    
    return { remaining };
  } catch (error) {
    console.error('[Sync Manager] Photo sync error:', error);
    return { remaining: 0 };
  }
}

// NOTE: The duplicate "online" listener that was here has been removed (P1).
// All sync orchestration (including photo sync) is handled by useAutoSync.tsx
// which provides proper guards: cooldown, batch limits, syncInProgressRef.
