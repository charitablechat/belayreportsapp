import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Upload, CloudOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache } from "@/lib/cached-auth";
import { savePhotoOffline, markPhotoAsUploaded } from "@/lib/offline-storage";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { triggerHaptic } from "@/lib/haptics";
import { compressImage } from "@/lib/image-compression";
import { toast } from "sonner";

interface PhotoCaptureProps {
  inspectionId: string;
  section: string;
  onPhotoAdded: () => void;
}

export default function PhotoCapture({ inspectionId, section, onPhotoAdded }: PhotoCaptureProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { isOnline } = useNetworkStatus();
  const uploadMutexRef = useRef(false);

  /**
   * Fire-and-forget background upload function
   * Does NOT block UI - runs entirely in background
   */
  const uploadPhotoInBackground = async (
    photoId: string,
    processedFile: File,
    userId: string
  ) => {
    try {
      const fileExt = processedFile.name.split('.').pop() || 'jpg';
      const fileName = `${userId}/${inspectionId}/${Date.now()}.${fileExt}`;
      
      // Upload to Supabase storage
      const { error: uploadError } = await supabase.storage
        .from('inspection-photos')
        .upload(fileName, processedFile);

      if (uploadError) throw uploadError;

      // Insert database record
      const { error: dbError } = await supabase
        .from('inspection_photos')
        .insert({
          inspection_id: inspectionId,
          photo_url: fileName,
          photo_section: section,
        });

      if (dbError) throw dbError;

      // Mark as uploaded in IndexedDB (updates "Pending" to "Synced" badge)
      await markPhotoAsUploaded(photoId, fileName);
      
      if (import.meta.env.DEV) {
        console.log('[PhotoCapture] Background sync completed:', photoId);
      }
    } catch (error) {
      // Photo remains in IndexedDB with uploaded=false
      // Will be synced by useAutoSync on next interval
      console.warn('[PhotoCapture] Background sync failed, queued for later:', error);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Prevent concurrent uploads (mutex lock)
    if (uploadMutexRef.current) {
      console.log('[PhotoCapture] Upload already in progress, ignoring');
      return;
    }
    const files = e.target.files;
    if (!files || files.length === 0) return;

    uploadMutexRef.current = true;
    triggerHaptic('light');
    setUploading(true);

    try {
      const user = await getUserWithCache();
      if (!user) throw new Error("Not authenticated");

      for (const file of Array.from(files)) {
        // Compress image before save (30-50% size reduction typical)
        let processedFile = file;
        try {
          if (file.type.startsWith('image/')) {
            processedFile = await compressImage(file, {
              maxWidth: 1920,
              maxHeight: 1920,
              quality: 0.85,
              maxSizeMB: 3,
            });
            
            if (import.meta.env.DEV) {
              const savedKB = ((file.size - processedFile.size) / 1024).toFixed(1);
              console.log(`[PhotoCapture] Compressed ${file.name}: saved ${savedKB}KB`);
            }
          }
        } catch (compressionError) {
          const errorMessage = compressionError instanceof Error ? compressionError.message : 'Unknown error';
          const fileSizeKB = (file.size / 1024).toFixed(1);
          console.warn(
            `[PhotoCapture] Compression failed for ${file.name} (${fileSizeKB}KB, ${file.type}):`,
            errorMessage
          );
          
          if (import.meta.env.DEV) {
            toast.error(`Photo compression failed: ${errorMessage}. Using original file.`);
          }
          // Continue with original file if compression fails
        }

        // ===== LOCAL-FIRST ARCHITECTURE =====
        // ALWAYS save to IndexedDB FIRST (regardless of online status)
        const photoId = `${inspectionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await savePhotoOffline({
          id: photoId,
          inspectionId,
          section,
          blob: processedFile,
          fileName: processedFile.name,
          uploaded: false,
        });
        
        if (import.meta.env.DEV) {
          console.log('[PhotoCapture] Photo saved locally:', photoId);
        }

        // IMMEDIATELY refresh gallery (user sees photo with "Pending" badge)
        onPhotoAdded();

        // If online, attempt background sync (fire-and-forget - NO await)
        if (isOnline) {
          // Fire-and-forget: don't await, don't block UI
          uploadPhotoInBackground(photoId, processedFile, user.id).catch(() => {
            // Already logged inside the function
          });
        }
      }

      triggerHaptic('success');
      
      // Show immediate success feedback based on LOCAL save
      toast.success('Photo saved', {
        description: isOnline ? 'Syncing to cloud...' : 'Will sync when online',
        duration: 2000,
      });
    } catch (error: any) {
      console.error("Photo capture error:", error);
      triggerHaptic('error');
      toast.error('Failed to save photo', {
        description: error.message || 'Please try again',
      });
    } finally {
      setUploading(false);
      uploadMutexRef.current = false;
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="flex gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="flex-1"
      >
        {uploading ? (
          <>
            <Upload className="w-4 h-4 mr-2 animate-spin" />
            Saving...
          </>
        ) : (
          <>
            {!isOnline && <CloudOff className="w-4 h-4 mr-2" />}
            {isOnline && <Camera className="w-4 h-4 mr-2" />}
            Add Photo
          </>
        )}
      </Button>
    </div>
  );
}
