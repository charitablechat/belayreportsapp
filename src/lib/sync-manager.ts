import { supabase } from "@/integrations/supabase/client";
import { 
  getUnsyncedInspections, 
  saveInspectionOffline, 
  getQueuedOperations, 
  removeQueuedOperation,
  incrementOperationRetry,
  getUnuploadedPhotos,
  markPhotoAsUploaded,
  deleteOfflinePhoto
} from "./offline-storage";
import { toast } from "sonner";

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // Start with 1 second

export async function syncInspections() {
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Offline - skipping sync');
    }
    return;
  }

  if (import.meta.env.DEV) {
    console.log('[Sync Manager] Starting sync...');
  }

  try {
    // 1. Process queued operations first
    const queuedOps = await getQueuedOperations();
    
    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Processing queued operations:', queuedOps.length);
    }

    for (const op of queuedOps) {
      try {
        if (op.retries >= MAX_RETRIES) {
          if (import.meta.env.DEV) {
            console.warn('[Sync Manager] Max retries reached for operation:', op);
          }
          continue;
        }

        if (op.type === 'create' || op.type === 'update') {
          await supabase.from("inspections").upsert(op.data);
        } else if (op.type === 'delete') {
          await supabase.from("inspections").delete().eq('id', op.inspectionId);
        }

        await removeQueuedOperation(op.id);
        
        if (import.meta.env.DEV) {
          console.log('[Sync Manager] Processed operation:', op.type, op.inspectionId);
        }
      } catch (error) {
        console.error('[Sync Manager] Operation failed:', error);
        await incrementOperationRetry(op.id);
        
        // Exponential backoff
        await new Promise(resolve => 
          setTimeout(resolve, RETRY_DELAY * Math.pow(2, op.retries))
        );
      }
    }

    // 2. Sync unsynced inspections
    const unsynced = await getUnsyncedInspections();
    
    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Syncing unsynced inspections:', unsynced.length);
    }
    
    for (const inspection of unsynced) {
      try {
        // Check if inspection exists in remote
        const { data: remoteData } = await supabase
          .from("inspections")
          .select("updated_at")
          .eq("id", inspection.id)
          .maybeSingle();

        // Conflict resolution: last-write-wins
        if (remoteData) {
          const remoteUpdated = new Date(remoteData.updated_at).getTime();
          const localUpdated = new Date(inspection.updated_at).getTime();
          
          if (remoteUpdated > localUpdated) {
            if (import.meta.env.DEV) {
              console.log('[Sync Manager] Remote is newer, skipping:', inspection.id);
            }
            continue; // Remote is newer, skip local update
          }
        }

        // Sync to Supabase
        const { error } = await supabase
          .from("inspections")
          .upsert({
            ...inspection,
            synced_at: new Date().toISOString(),
          });

        if (error) throw error;

        // Update local storage with sync timestamp
        await saveInspectionOffline({
          ...inspection,
          synced_at: new Date().toISOString(),
        });

        if (import.meta.env.DEV) {
          console.log('[Sync Manager] Synced inspection:', inspection.id);
        }
      } catch (error) {
        console.error('[Sync Manager] Failed to sync inspection:', inspection.id, error);
        // Continue with other inspections even if one fails
      }
    }

    if (unsynced.length > 0) {
      toast.success(`Synced ${unsynced.length} inspection(s)`);
      
      if (import.meta.env.DEV) {
        console.log('[Sync Manager] Sync completed successfully');
      }
    }
  } catch (error) {
    console.error('[Sync Manager] Sync error:', error);
    toast.error("Failed to sync inspections");
  }
}

// Photo sync manager
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
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const fileExt = photo.fileName.split('.').pop();
        const fileName = `${user.id}/${photo.inspectionId}/${Date.now()}.${fileExt}`;
        
        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('inspection-photos')
          .upload(fileName, photo.blob);

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('inspection-photos')
          .getPublicUrl(fileName);

        // Save to database
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

    if (successCount > 0) {
      toast.success(`Uploaded ${successCount} photo(s)`);
      
      if (import.meta.env.DEV) {
        console.log('[Sync Manager] Photo sync completed:', successCount);
      }
    }
  } catch (error) {
    console.error('[Sync Manager] Photo sync error:', error);
    toast.error("Failed to sync photos");
  }
}

// Auto-sync when coming online
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Network online, triggering sync...');
    }
    setTimeout(() => {
      syncInspections();
      syncPhotos();
    }, 1000);
  });
}
