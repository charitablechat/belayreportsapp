import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Upload, CloudOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache } from "@/lib/cached-auth";
import { savePhotoOffline } from "@/lib/offline-storage";
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
        // Compress image before upload (30-50% size reduction typical)
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

        if (isOnline) {
          // Online: Upload directly to Supabase
          const fileExt = processedFile.name.split('.').pop();
          const fileName = `${user.id}/${inspectionId}/${Date.now()}.${fileExt}`;
          
          const { error: uploadError } = await supabase.storage
            .from('inspection-photos')
            .upload(fileName, processedFile);

          if (uploadError) throw uploadError;

          // Save to database
          const { error: dbError } = await supabase
            .from('inspection_photos')
            .insert({
              inspection_id: inspectionId,
              photo_url: fileName,
              photo_section: section,
            });

          if (dbError) throw dbError;
        } else {
          // Offline: Save to IndexedDB
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
            console.log('[PhotoCapture] Saved compressed photo offline:', photoId);
          }
        }
      }

      triggerHaptic('success');
      onPhotoAdded();
    } catch (error: any) {
      console.error("Photo capture error:", error);
      triggerHaptic('error');
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
            {isOnline ? 'Uploading...' : 'Saving...'}
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
