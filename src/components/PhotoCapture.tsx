import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Upload, CloudOff, ImagePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache } from "@/lib/cached-auth";
import { savePhotoOffline, markPhotoAsUploaded } from "@/lib/offline-storage";
import { savePhotoReceipt } from "@/lib/photo-receipts";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { triggerHaptic } from "@/lib/haptics";
import { compressImage } from "@/lib/image-compression";
import { isHeicFile } from "@/lib/heic-converter";
import { saveToDevice } from "@/lib/save-to-device";
import { toast } from "sonner";

type PhotoTableName = "inspection_photos" | "training_photos" | "daily_assessment_photos";

interface PhotoCaptureProps {
  inspectionId: string;
  section: string;
  onPhotoAdded: () => void;
  tableName?: PhotoTableName;
  foreignKeyColumn?: string;
  storageBucket?: string;
}

// Supported image types
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_FILE_SIZE_MB = 25;

// Timeout constants — relaxed to prevent false timeouts on mobile
const PER_FILE_TIMEOUT = 30000; // 30s per file (compression can be slow on iPad)

/**
 * Validate file type and size before processing
 */
function validateFile(file: File): { valid: boolean; error?: string } {
  if (!SUPPORTED_TYPES.includes(file.type) && !file.type.startsWith('image/')) {
    return { valid: false, error: `Unsupported file type: ${file.type || 'unknown'}. Please use JPEG, PNG, or WebP.` };
  }
  const fileSizeMB = file.size / (1024 * 1024);
  if (fileSizeMB > MAX_FILE_SIZE_MB) {
    return { valid: false, error: `File too large (${fileSizeMB.toFixed(1)}MB). Maximum size is ${MAX_FILE_SIZE_MB}MB.` };
  }
  return { valid: true };
}

export default function PhotoCapture({ 
  inspectionId, 
  section, 
  onPhotoAdded,
  tableName = "inspection_photos",
  foreignKeyColumn = "inspection_id",
  storageBucket = "inspection-photos",
}: PhotoCaptureProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { isOnline } = useNetworkStatus();
  const uploadMutexRef = useRef(false);

  /**
   * Fire-and-forget background upload — does NOT block UI
   */
  const uploadPhotoInBackground = async (
    photoId: string,
    processedFile: File,
    userId: string
  ) => {
    try {
      const fileExt = processedFile.name.split('.').pop() || 'jpg';
      const fileName = `${userId}/${inspectionId}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from(storageBucket)
        .upload(fileName, processedFile);
      if (uploadError) throw uploadError;

      const { error: dbError } = await (supabase.from(tableName) as any).insert({
        [foreignKeyColumn]: inspectionId,
        photo_url: fileName,
        photo_section: section,
      });
      if (dbError) throw dbError;

      await markPhotoAsUploaded(photoId, fileName);
      
      if (import.meta.env.DEV) {
        console.log('[PhotoCapture] Background sync completed:', photoId);
      }
    } catch (error) {
      console.warn('[PhotoCapture] Background sync failed, queued for later:', error);
    }
  };

  /**
   * Process a single file — LOCAL-FIRST: saves to IndexedDB before any network call.
   * Auth is NOT required for local save; only needed for background upload.
   */
  const processSingleFile = async (file: File): Promise<boolean> => {
    const validation = validateFile(file);
    if (!validation.valid) {
      toast.error('Invalid file', { description: validation.error });
      return false;
    }

    // Compress image (has internal timeout protection)
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
      console.warn(`[PhotoCapture] Compression failed for ${file.name}:`, compressionError);
      // Continue with original file
    }

    // Block HEIC files that survived the compression pipeline
    if (isHeicFile(processedFile)) {
      toast.error('Photo format not supported', {
        description: 'HEIC conversion failed. Please convert to JPEG before uploading.',
      });
      return false;
    }

    // Auto-save to device Downloads folder (fire-and-forget)
    const deviceFileName = `RopeWorks_${section}_${Date.now()}.jpg`;
    saveToDevice(processedFile, deviceFileName);

    // ===== LOCAL-FIRST: Save to IndexedDB IMMEDIATELY (no auth required) =====
    const photoId = `${inspectionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const saved = await savePhotoOffline({
      id: photoId,
      inspectionId,
      section,
      blob: processedFile,
      fileName: processedFile.name,
      uploaded: false,
      tableName,
      storageBucket,
      foreignKeyColumn,
    });

    if (!saved) {
      toast.error('Local storage unavailable', {
        description: 'Unable to save photo locally. Please check device storage.',
      });
      return false;
    }
    
    // Save lightweight receipt to localStorage (survives IndexedDB eviction)
    savePhotoReceipt({
      id: photoId,
      inspectionId,
      section,
      timestamp: Date.now(),
      uploaded: false,
    });
    
    if (import.meta.env.DEV) {
      console.log('[PhotoCapture] Photo saved locally with receipt:', photoId);
    }

    // IMMEDIATELY refresh gallery (user sees photo with "Pending" badge)
    onPhotoAdded();

    // If online, attempt background sync (fire-and-forget — NO await, NO blocking)
    if (isOnline) {
      // Resolve user identity in background — failure is OK, sync will retry later
      getUserWithCache()
        .then(user => {
          if (user?.id) {
            uploadPhotoInBackground(photoId, processedFile, user.id).catch(() => {});
          }
        })
        .catch(() => {
          // Auth failed — photo stays queued in IndexedDB for useAutoSync
        });
    }

    return true;
  };

  const processFiles = async (files: FileList | null) => {
    // Block all writes in Lovable preview
    if ((await import('@/lib/environment')).isLovablePreview()) {
      toast.info("Preview mode", { description: "Photo uploads are disabled in the Lovable preview." });
      return;
    }
    // Prevent concurrent uploads (mutex lock)
    if (uploadMutexRef.current) {
      console.log('[PhotoCapture] Upload already in progress, ignoring');
      return;
    }
    if (!files || files.length === 0) return;

    uploadMutexRef.current = true;
    triggerHaptic('light');
    setUploading(true);

    // SAFETY: Scale timeout with file count — 30s per file, minimum 30s
    const safetyTimeoutMs = Math.max(30000, files.length * PER_FILE_TIMEOUT);
    const safetyTimeout = setTimeout(() => {
      if (uploadMutexRef.current) {
        console.warn('[PhotoCapture] Safety timeout reached - force releasing mutex');
        uploadMutexRef.current = false;
        setUploading(false);
        toast.error('Photo processing timed out', {
          description: 'Please try again with fewer or smaller images',
        });
      }
    }, safetyTimeoutMs);

    let successCount = 0;
    let errorCount = 0;

    try {
      const fileArray = Array.from(files);
      for (let i = 0; i < fileArray.length; i++) {
        // Yield to main thread between files — prevents UI freeze on iPad Safari
        if (i > 0) await new Promise(r => setTimeout(r, 0));

        try {
          // Per-file timeout wrapping
          const success = await Promise.race([
            processSingleFile(fileArray[i]),
            new Promise<boolean>((_, reject) =>
              setTimeout(() => reject(new Error('Per-file timeout')), PER_FILE_TIMEOUT)
            )
          ]);
          
          if (success) {
            successCount++;
          } else {
            errorCount++;
          }
        } catch (fileError: any) {
          console.warn('[PhotoCapture] File processing failed/timed out:', fileError.message);
          errorCount++;
        }
      }

      if (successCount > 0) {
        triggerHaptic('success');
        toast.success(successCount === 1 ? 'Photo saved' : `${successCount} photos saved`, {
          description: isOnline ? 'Syncing to cloud...' : 'Will sync when online',
          duration: 2000,
        });
      }
      
      if (errorCount > 0 && successCount === 0) {
        triggerHaptic('error');
        toast.error('Failed to process photos', {
          description: 'Please try again with different images',
        });
      }
    } catch (error: any) {
      console.error("Photo capture error:", error);
      triggerHaptic('error');
      toast.error('Failed to save photo', {
        description: error.message || 'Please try again',
      });
    } finally {
      clearTimeout(safetyTimeout);
      setUploading(false);
      uploadMutexRef.current = false;
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
  };

  return (
    <div className="flex gap-2">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={handleCameraCapture}
        className="hidden"
      />
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        onChange={handleFileUpload}
        className="hidden"
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => cameraInputRef.current?.click()}
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
            Take Photo
          </>
        )}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => uploadInputRef.current?.click()}
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
            <ImagePlus className="w-4 h-4 mr-2" />
            Upload
          </>
        )}
      </Button>
    </div>
  );
}
