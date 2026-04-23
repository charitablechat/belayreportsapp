import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, CloudOff, ImagePlus, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache } from "@/lib/cached-auth";
import { savePhotoOffline, markPhotoAsUploaded, getCircuitBreakerStatus } from "@/lib/offline-storage";
import { saveToDevice } from "@/lib/save-to-device";
import { savePhotoReceipt } from "@/lib/photo-receipts";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { triggerHaptic } from "@/lib/haptics";
import { compressImage } from "@/lib/image-compression";
import { isHeicFile } from "@/lib/heic-converter";

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
const MAX_FILE_SIZE_MB = 20;

// Timeout constants — reduced to prevent long hangs
const PER_FILE_TIMEOUT = 15000; // 15s per file (down from 30s)
const MAX_SAFETY_TIMEOUT = 45000; // 45s cap regardless of file count

/**
 * Validate file type and size before processing
 */
function validateFile(file: File): { valid: boolean; error?: string } {
  if (file.size === 0) {
    return { valid: false, error: 'File is empty (0 bytes). Please choose a different photo.' };
  }
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
  const cancelledRef = useRef(false);

  /**
   * Fire-and-forget background upload — does NOT block UI.
   */
  const uploadPhotoInBackground = async (
    photoId: string,
    processedFile: File,
    userId: string,
    storagePath: string
  ) => {
    try {
      const { error: uploadError } = await supabase.storage
        .from(storageBucket)
        .upload(storagePath, processedFile, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: existing } = await (supabase
        .from(tableName) as any)
        .select('id')
        .eq('photo_url', storagePath)
        .eq(foreignKeyColumn, inspectionId)
        .maybeSingle();

      if (!existing) {
        const { error: dbError } = await (supabase.from(tableName) as any).insert({
          [foreignKeyColumn]: inspectionId,
          photo_url: storagePath,
          photo_section: section,
        });
        if (dbError && !dbError.message?.includes('duplicate') && !dbError.code?.includes('23505')) {
          throw dbError;
        }
      }

      await markPhotoAsUploaded(photoId, storagePath);
      onPhotoAdded();
      
      if (import.meta.env.DEV) {
        console.log('[PhotoCapture] Background sync completed:', photoId);
      }
    } catch (error) {
      console.warn('[PhotoCapture] Background sync failed, queued for later:', error);
    }
  };

  /**
   * Process a single file — LOCAL-FIRST: saves to IndexedDB before any network call.
   * If circuit breaker is open, falls back to receipt-only mode immediately.
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
    }

    // Block HEIC files that survived the compression pipeline
    if (isHeicFile(processedFile)) {
      toast.error('Photo format not supported', {
        description: 'HEIC conversion failed. Please convert to JPEG before uploading.',
      });
      return false;
    }

    const photoId = `${inspectionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const fileExt = processedFile.name.split('.').pop() || 'jpg';

    let storagePath: string;
    try {
      const user = await getUserWithCache();
      if (user?.id) {
        storagePath = `${user.id}/${inspectionId}/${photoId}.${fileExt}`;
      } else {
        storagePath = `pending/${inspectionId}/${photoId}.${fileExt}`;
      }
    } catch {
      storagePath = `pending/${inspectionId}/${photoId}.${fileExt}`;
    }

    // ===== CIRCUIT BREAKER PRE-CHECK =====
    // If IndexedDB is already known-dead, skip the 8s timeout and go receipt-only
    const cbStatus = getCircuitBreakerStatus();
    if (cbStatus.open) {
      console.warn('[PhotoCapture] Circuit breaker open — saving receipt only');
      
      savePhotoReceipt({
        id: photoId,
        inspectionId,
        section,
        timestamp: Date.now(),
        uploaded: false,
      });
      
      const deviceFileName = `RopeWorks_${section}_${Date.now()}.jpg`;
      saveToDevice(processedFile, deviceFileName);
      
      onPhotoAdded();
      
      toast.warning('Photo saved to backup', {
        description: 'Storage is recovering — photo will sync automatically',
        duration: 3000,
      });
      
      return true;
    }

    // ===== LOCAL-FIRST: Save to IndexedDB =====
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
      photoUrl: storagePath,
    });

    if (!saved) {
      // IDB failed but circuit breaker may have just tripped — save receipt as fallback
      savePhotoReceipt({
        id: photoId,
        inspectionId,
        section,
        timestamp: Date.now(),
        uploaded: false,
      });
      
      const deviceFileName = `RopeWorks_${section}_${Date.now()}.jpg`;
      saveToDevice(processedFile, deviceFileName);
      
      onPhotoAdded();
      
      toast.warning('Photo saved to backup', {
        description: 'Local storage unavailable — using backup. Will sync later.',
        duration: 3000,
      });
      return true;
    }
    
    // Save lightweight receipt to localStorage
    savePhotoReceipt({
      id: photoId,
      inspectionId,
      section,
      timestamp: Date.now(),
      uploaded: false,
    });
    
    // Save to device storage — fire-and-forget
    const deviceFileName = `RopeWorks_${section}_${Date.now()}.jpg`;
    saveToDevice(processedFile, deviceFileName);

    if (import.meta.env.DEV) {
      console.log('[PhotoCapture] Photo saved locally with receipt:', photoId);
    }

    // IMMEDIATELY refresh gallery
    onPhotoAdded();

    // If online AND not a temp ID, attempt background sync
    if (isOnline && !inspectionId.startsWith('temp-')) {
      getUserWithCache()
        .then(user => {
          if (user?.id) {
            uploadPhotoInBackground(photoId, processedFile, user.id, storagePath).catch(() => {});
          }
        })
        .catch(() => {});
    }

    return true;
  };

  const handleCancel = () => {
    cancelledRef.current = true;
  };

  const processFiles = async (files: FileList | null) => {
    // Block all writes in Lovable preview
    if ((await import('@/lib/environment')).isLovablePreview()) {
      toast.info("Preview mode", { description: "Photo uploads are disabled in the Lovable preview." });
      return;
    }
    if (uploadMutexRef.current) {
      console.log('[PhotoCapture] Upload already in progress, ignoring');
      return;
    }
    if (!files || files.length === 0) return;

    uploadMutexRef.current = true;
    cancelledRef.current = false;
    triggerHaptic('light');
    setUploading(true);

    // Cap safety timeout at MAX_SAFETY_TIMEOUT
    const safetyTimeoutMs = Math.min(MAX_SAFETY_TIMEOUT, Math.max(15000, files.length * PER_FILE_TIMEOUT));
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
        // Check cancel flag
        if (cancelledRef.current) {
          toast.info('Upload cancelled', {
            description: `${successCount} of ${fileArray.length} photos saved`,
          });
          break;
        }

        // Yield to main thread between files
        if (i > 0) await new Promise(r => setTimeout(r, 0));

        try {
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

      if (successCount > 0 && !cancelledRef.current) {
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
      cancelledRef.current = false;
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
      {uploading ? (
        <>
          <Button
            type="button"
            variant="outline"
            disabled
            className="flex-1"
          >
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Saving...
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleCancel}
            className="px-3"
          >
            <XCircle className="w-4 h-4" />
          </Button>
        </>
      ) : (
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => cameraInputRef.current?.click()}
            className="flex-1"
          >
            {!isOnline && <CloudOff className="w-4 h-4 mr-2" />}
            {isOnline && <Camera className="w-4 h-4 mr-2" />}
            Take Photo
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => uploadInputRef.current?.click()}
            className="flex-1"
          >
            <ImagePlus className="w-4 h-4 mr-2" />
            Upload
          </Button>
        </>
      )}
    </div>
  );
}
