import { useState, useRef, useCallback, useEffect, memo } from "react";
import { Camera, X, ImagePlus, Loader2, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CameraCaptureDialog } from "@/components/ui/camera-capture-dialog";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/image-compression";
import { toast } from "@/components/ui/sonner";
import { getUserWithCache } from "@/lib/cached-auth";
import { getCachedPhotoBlob, cachePhotoFromRemote } from "@/lib/photo-cache";
import { savePhotoOffline, markPhotoAsUploaded } from "@/lib/offline-storage";
import { savePhotoReceipt } from "@/lib/photo-receipts";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

interface ItemPhotoUploadProps {
  itemId: string;
  inspectionId: string;
  photoUrl: string | null;
  onPhotoChange: (url: string | null) => void;
  onImmediateSave?: () => void;
  disabled?: boolean;
  itemName?: string;
  photoSection?: string;
  onGalleryRefresh?: () => void;
}

function ItemPhotoUpload({
  itemId,
  inspectionId,
  photoUrl,
  onPhotoChange,
  onImmediateSave,
  disabled = false,
  itemName,
  photoSection,
  onGalleryRefresh,
}: ItemPhotoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isOfflinePhoto, setIsOfflinePhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevObjectUrlRef = useRef<string | null>(null);
  const { isOnline } = useNetworkStatus();

  const displayUrl = localPreview || signedUrl;

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (prevObjectUrlRef.current) URL.revokeObjectURL(prevObjectUrlRef.current);
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, []);

  const loadSignedUrl = useCallback(async () => {
    if (!photoUrl) { setSignedUrl(null); setIsOfflinePhoto(false); return; }

    // 1. Cache-first: check IndexedDB
    const cachedBlob = await getCachedPhotoBlob(photoUrl);
    if (cachedBlob) {
      // Revoke previous object URL to prevent memory leak
      if (prevObjectUrlRef.current) URL.revokeObjectURL(prevObjectUrlRef.current);
      const url = URL.createObjectURL(cachedBlob);
      prevObjectUrlRef.current = url;
      setSignedUrl(url);
      return;
    }

    // 2. Offline with no cache — mark as offline photo
    if (!navigator.onLine) {
      setIsOfflinePhoto(true);
      return;
    }

    // 3. Fetch signed URL from server
    try {
      const { data } = await supabase.storage
        .from("inspection-photos")
        .createSignedUrl(photoUrl, 3600);
      if (!data?.signedUrl) return;
      setSignedUrl(data.signedUrl);
      setIsOfflinePhoto(false);

      // 4. Download blob and cache for offline use
      try {
        const resp = await fetch(data.signedUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          await cachePhotoFromRemote(photoUrl, blob, photoUrl, inspectionId, 'item-photo');
        }
      } catch { /* non-critical */ }
    } catch { /* silent fail */ }
  }, [photoUrl, inspectionId]);

  useEffect(() => { loadSignedUrl(); }, [loadSignedUrl]);

  // Retry loading when coming back online
  useEffect(() => {
    if (isOnline && isOfflinePhoto && photoUrl) {
      loadSignedUrl();
    }
  }, [isOnline, isOfflinePhoto, photoUrl, loadSignedUrl]);

  /**
   * Fire-and-forget background upload — does NOT block UI
   */
  const uploadInBackground = useCallback(async (
    photoId: string,
    compressed: File,
    userId: string,
    filePath: string,
  ) => {
    try {
      // DB rows for item photos require a real UUID inspection_id.
      // If this report is still temp/local, keep the photo queued for sync.
      if (photoSection && inspectionId.startsWith('temp-')) {
        throw new Error('Inspection still has a temporary ID; deferring item photo sync');
      }

      const { error: uploadError } = await supabase.storage
        .from("inspection-photos")
        .upload(filePath, compressed, { contentType: "image/jpeg", upsert: true });

      if (uploadError) throw uploadError;

      // ✅ Mark uploaded FIRST to close race window with syncPhotos
      await markPhotoAsUploaded(photoId, filePath);

      // Insert into gallery if applicable
      if (photoSection) {
        const { error: galleryError } = await supabase.from('inspection_photos').insert({
          inspection_id: inspectionId,
          photo_url: filePath,
          photo_section: photoSection,
          caption: itemName || 'Item photo',
        });

        if (galleryError) throw galleryError;
        onGalleryRefresh?.();
      }

      // Update signed URL for display
      const { data: signedData } = await supabase.storage
        .from("inspection-photos")
        .createSignedUrl(filePath, 3600);
      if (signedData?.signedUrl) {
        setSignedUrl(signedData.signedUrl);
        setLocalPreview(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
      }

      if (import.meta.env.DEV) {
        console.log('[ItemPhotoUpload] Background upload completed:', photoId);
      }
    } catch (error) {
      // Photo remains in IndexedDB with uploaded=false — useAutoSync will retry
      console.warn('[ItemPhotoUpload] Background upload failed, queued for later:', error);
    }
  }, [inspectionId, photoSection, itemName, onGalleryRefresh]);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      // 1. Compress image
      const compressed = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.8 });

      // 2. Instant local preview
      const previewUrl = URL.createObjectURL(compressed);
      setLocalPreview(previewUrl);

      // 3. Generate deterministic file path (userId resolved later for background upload)
      const photoId = `item-${itemId}-${Date.now()}`;
      // Use a placeholder path; background upload will use proper userId path
      const placeholderPath = `pending/${inspectionId}/items/${itemId}.jpg`;

      // 4. LOCAL-FIRST: Save to IndexedDB IMMEDIATELY (no auth required)
      const saved = await savePhotoOffline({
        id: photoId,
        inspectionId,
        section: photoSection || 'item-photo',
        blob: compressed,
        fileName: `${itemId}.jpg`,
        uploaded: false,
        photoUrl: placeholderPath,
        tableName: 'inspection_photos',
        storageBucket: 'inspection-photos',
        foreignKeyColumn: 'inspection_id',
        caption: itemName || 'Item photo',
      });

      if (!saved) {
        toast.error('Local storage unavailable', {
          description: 'Unable to save photo locally. Please check device storage.',
        });
        setLocalPreview(null);
        return;
      }

      // 5. Save lightweight receipt to localStorage
      savePhotoReceipt({
        id: photoId,
        inspectionId,
        section: photoSection || 'item-photo',
        timestamp: Date.now(),
        uploaded: false,
      });

      // 6. Update form state immediately
      onPhotoChange(placeholderPath);
      onImmediateSave?.();

      // 7. Background upload if online (fire-and-forget, auth resolved here)
      if (isOnline) {
        toast.info("Syncing photo...");
        getUserWithCache()
          .then(user => {
            if (user?.id) {
              const realPath = `${user.id}/${inspectionId}/items/${itemId}.jpg`;
              onPhotoChange(realPath); // Update to real path
              uploadInBackground(photoId, compressed, user.id, realPath).catch(() => {});
            }
          })
          .catch(() => {
            // Auth failed — photo stays queued for useAutoSync
          });
      } else {
        toast.success("Photo saved locally", {
          description: "Will sync when back online",
        });
      }
    } catch (err: any) {
      console.error("[ItemPhotoUpload] Save failed:", err);
      toast.error(err?.message || "Failed to save photo");
      setLocalPreview(null);
    } finally {
      setUploading(false);
    }
  }, [itemId, inspectionId, onPhotoChange, onImmediateSave, photoSection, isOnline, uploadInBackground, itemName]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = "";
  }, [handleUpload]);

  const handleRemove = useCallback(async () => {
    if (photoUrl) {
      try {
        await supabase.storage.from("inspection-photos").remove([photoUrl]);
      } catch {
        // silent
      }
      // Also remove from gallery
      if (photoSection && inspectionId) {
        try {
          await supabase.from('inspection_photos')
            .delete()
            .eq('photo_url', photoUrl)
            .eq('inspection_id', inspectionId);
          onGalleryRefresh?.();
        } catch { /* non-critical */ }
      }
    }
    setLocalPreview(null);
    setSignedUrl(null);
    setIsOfflinePhoto(false);
    onPhotoChange(null);
    onImmediateSave?.();
    setLightboxOpen(false);
  }, [photoUrl, onPhotoChange, onImmediateSave, photoSection, inspectionId, onGalleryRefresh]);

  const hasPhoto = !!(photoUrl || localPreview);

  return (
    <>
      {/* File browse input (no capture) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled}
      />

      {/* Native camera capture dialog */}
      <CameraCaptureDialog
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onCapture={(file) => handleUpload(file)}
      />

      {hasPhoto && displayUrl ? (
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="relative w-12 h-12 rounded-md overflow-hidden border border-border hover:border-primary transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={disabled}
        >
          <img src={displayUrl} alt="Item photo" className="w-full h-full object-cover" />
          {uploading && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            </div>
          )}
          {!isOnline && (
            <div className="absolute top-0 right-0 p-0.5 bg-background/80 rounded-bl">
              <CloudOff className="w-3 h-3 text-muted-foreground" />
            </div>
          )}
        </button>
      ) : hasPhoto && isOfflinePhoto ? (
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="relative w-12 h-12 rounded-md overflow-hidden border border-border bg-muted flex items-center justify-center"
          disabled={disabled}
        >
          <CloudOff className="w-5 h-5 text-muted-foreground" />
        </button>
      ) : (
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCameraOpen(true)}
            disabled={disabled || uploading}
            className="w-10 h-10 p-0"
            title="Take photo"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4 text-muted-foreground" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || uploading}
            className="w-10 h-10 p-0"
            title="Upload from device"
          >
            <ImagePlus className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>
      )}

      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Item Photo</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            {displayUrl ? (
              <img src={displayUrl} alt="Item photo full size" className="max-w-full max-h-[60vh] object-contain rounded-lg" />
            ) : isOfflinePhoto ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <CloudOff className="w-8 h-8" />
                <p className="text-sm">Photo will load when back online</p>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setLightboxOpen(false); setCameraOpen(true); }} disabled={disabled || uploading}>
                <Camera className="w-4 h-4 mr-2" />
                Take Photo
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={disabled || uploading}>
                <ImagePlus className="w-4 h-4 mr-2" />
                Upload
              </Button>
              <Button variant="destructive" size="sm" onClick={handleRemove} disabled={disabled}>
                <X className="w-4 h-4 mr-2" />
                Remove
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default memo(ItemPhotoUpload);
