import { useState, useRef, useCallback, useEffect, memo } from "react";
import { Camera, X, ImagePlus, Loader2, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { CameraCaptureDialog } from "@/components/ui/camera-capture-dialog";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/image-compression";
import { toast } from "@/components/ui/sonner";
import { getUserWithCache } from "@/lib/cached-auth";
import { getCachedPhotoBlob, cachePhotoFromRemote } from "@/lib/photo-cache";
import { savePhotoOffline, markPhotoAsUploaded, updatePhotoPath, getCircuitBreakerStatus, updateOfflinePhotoCaption } from "@/lib/offline-storage";
import { savePhotoReceipt } from "@/lib/photo-receipts";
import { saveToDevice } from "@/lib/save-to-device";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { setOverlayActive } from "@/lib/navigation";

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
  const lightboxHistoryPushedRef = useRef(false);

  const displayUrl = localPreview || signedUrl;

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    setOverlayActive(false);
    if (lightboxHistoryPushedRef.current) {
      lightboxHistoryPushedRef.current = false;
      window.history.back();
    }
  }, []);

  // Ref to track open state for the popstate handler (avoids stale closures)
  const lightboxOpenRef = useRef(false);

  // Push history state when lightbox opens; listen for popstate to close it
  useEffect(() => {
    lightboxOpenRef.current = lightboxOpen;

    if (lightboxOpen) {
      window.history.pushState({ lightbox: true }, '');
      lightboxHistoryPushedRef.current = true;
      setOverlayActive(true);
    }
    const onPopState = () => {
      if (lightboxOpenRef.current) {
        lightboxHistoryPushedRef.current = false;
        setOverlayActive(false);
        setLightboxOpen(false);
        lightboxOpenRef.current = false;
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [lightboxOpen]);

  // Track localPreview in a ref so unmount cleanup always revokes the latest URL
  const localPreviewRef = useRef<string | null>(null);
  useEffect(() => { localPreviewRef.current = localPreview; }, [localPreview]);

  // Track latest itemName so async upload paths pick up renames mid-flight
  const itemNameRef = useRef<string | undefined>(itemName);
  useEffect(() => { itemNameRef.current = itemName; }, [itemName]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (prevObjectUrlRef.current) URL.revokeObjectURL(prevObjectUrlRef.current);
      if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
    };
  }, []);

  // Keep gallery caption in sync when the item is renamed after the photo
  // was uploaded. Debounced to avoid a write per keystroke.
  // Determine the gallery table for this section once.
  const galleryTable = photoSection === 'systems' || photoSection === 'equipment'
    ? 'inspection_photos'
    : null;
  useEffect(() => {
    if (!galleryTable) return;
    if (!photoUrl || photoUrl.startsWith('pending/')) return;
    const trimmed = (itemName || '').trim();
    if (!trimmed) return;
    if (!inspectionId || inspectionId.startsWith('temp-')) return;

    const timer = setTimeout(async () => {
      // Update IDB-cached caption (works offline too)
      try {
        const photoId = `item-${itemId}`; // best-effort; offline records use deterministic id prefix + ts
        // Walk all offline photos for this inspection and patch matching ones by photoUrl
        const { getOfflinePhotos } = await import('@/lib/offline-storage');
        const offline = await getOfflinePhotos(inspectionId);
        for (const p of offline) {
          if (p.photoUrl === photoUrl && p.caption !== trimmed) {
            await updateOfflinePhotoCaption(p.id, trimmed);
          }
        }
        void photoId;
      } catch { /* non-critical */ }

      if (!navigator.onLine) return;
      try {
        await supabase
          .from(galleryTable as 'inspection_photos')
          .update({ caption: trimmed })
          .eq('inspection_id', inspectionId)
          .eq('photo_url', photoUrl)
          .is('deleted_at', null);
        onGalleryRefresh?.();
      } catch { /* non-critical */ }
    }, 600);

    return () => clearTimeout(timer);
  }, [itemName, photoUrl, inspectionId, photoSection, galleryTable, itemId, onGalleryRefresh]);

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
        // Dedup guard: skip insert if a row already exists for this photo_url + inspection_id
        const { data: existing } = await supabase.from('inspection_photos')
          .select('id')
          .eq('photo_url', filePath)
          .eq('inspection_id', inspectionId)
          .maybeSingle();

        if (!existing) {
          const { error: galleryError } = await supabase.from('inspection_photos').insert({
            inspection_id: inspectionId,
            photo_url: filePath,
            photo_section: photoSection,
            caption: (itemNameRef.current || itemName || '').trim() || 'Item photo',
          });

          if (galleryError) throw galleryError;
        }
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

    // Safety timeout — force-clear spinner after 15s no matter what
    const safetyTimer = setTimeout(() => {
      setUploading(false);
      toast.error("Photo processing timed out", {
        description: "The photo was saved locally. It will sync later.",
      });
    }, 15000);

    try {
      // Resolve freshest itemName at capture time (covers rapid type→snap)
      const liveName = (itemNameRef.current || itemName || '').trim();
      const captionFromName = liveName || 'Item photo';

      // 1. Compress image
      const compressed = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.8 });

      // 2. Instant local preview
      const previewUrl = URL.createObjectURL(compressed);
      setLocalPreview(previewUrl);

      // 3. Generate deterministic file path
      const photoId = `item-${itemId}-${Date.now()}`;
      const placeholderPath = `pending/${inspectionId}/items/${itemId}.jpg`;
      const deviceFileName = `RopeWorks_${photoSection || 'item'}_${Date.now()}.jpg`;

      // 4. Circuit breaker pre-check — skip IDB if it's known-dead
      const cbStatus = getCircuitBreakerStatus();
      if (cbStatus.open) {
        console.warn('[ItemPhotoUpload] Circuit breaker open — skipping IDB, saving receipt');
        savePhotoReceipt({
          id: photoId,
          inspectionId,
          section: photoSection || 'item-photo',
          timestamp: Date.now(),
          uploaded: false,
        });
        saveToDevice(compressed, deviceFileName);
        onGalleryRefresh?.();
        onPhotoChange(placeholderPath);
        onImmediateSave?.();
        toast.success("Photo saved to backup storage", {
          description: "Will sync when storage recovers",
        });
        return; // skip IDB entirely
      }

      // 5. LOCAL-FIRST: Save to IndexedDB
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
        caption: captionFromName,
      });

      // 6. Save receipt (always, regardless of IDB success)
      savePhotoReceipt({
        id: photoId,
        inspectionId,
        section: photoSection || 'item-photo',
        timestamp: Date.now(),
        uploaded: false,
      });

      if (!saved) {
        // IDB failed but circuit breaker wasn't open yet — graceful fallback
        console.warn('[ItemPhotoUpload] IDB save failed — falling back to receipt + device save');
        saveToDevice(compressed, deviceFileName);
        // Keep preview visible — don't clear it
        onGalleryRefresh?.();
        onPhotoChange(placeholderPath);
        onImmediateSave?.();
        toast.success("Photo saved to backup storage", {
          description: "Will sync when storage recovers",
        });
        return;
      }

      // Save photo to device's local storage — fire-and-forget
      saveToDevice(compressed, deviceFileName);

      // ✅ Immediately refresh gallery
      onGalleryRefresh?.();

      // 7. Update form state immediately
      onPhotoChange(placeholderPath);
      onImmediateSave?.();

      // 8. Background upload if online
      if (isOnline) {
        toast.info("Syncing photo...");
        getUserWithCache()
          .then(async (user) => {
            if (user?.id) {
              const realPath = `${user.id}/${inspectionId}/items/${itemId}.jpg`;
              await updatePhotoPath(photoId, realPath);
              onPhotoChange(realPath);
              uploadInBackground(photoId, compressed, user.id, realPath).catch(() => {});
            }
          })
          .catch(() => {});
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
      clearTimeout(safetyTimer);
      setUploading(false);
    }
  }, [itemId, inspectionId, onPhotoChange, onImmediateSave, photoSection, isOnline, uploadInBackground, itemName, onGalleryRefresh]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = "";
  }, [handleUpload]);

  const handleRemove = useCallback(async () => {
    if (photoUrl) {
      // Soft-delete: set deleted_at + 60-day retention (consistent with PhotoGallery)
      const now = new Date();
      const retentionDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
      const deletedAt = now.toISOString();
      const retentionUntil = retentionDate.toISOString();

      if (photoSection && inspectionId) {
        try {
          await supabase.from('inspection_photos')
            .update({ deleted_at: deletedAt, retention_until: retentionUntil })
            .eq('photo_url', photoUrl)
            .eq('inspection_id', inspectionId);
          onGalleryRefresh?.();
        } catch { /* non-critical */ }
      }
      // Note: storage blob is NOT removed — it will be cleaned up when retention expires
    }
    setLocalPreview(null);
    setSignedUrl(null);
    setIsOfflinePhoto(false);
    onPhotoChange(null);
    onImmediateSave?.();
    closeLightbox();
  }, [photoUrl, onPhotoChange, onImmediateSave, photoSection, inspectionId, onGalleryRefresh, closeLightbox]);

  const hasPhoto = !!(photoUrl || localPreview);

  return (
    <>
      {/* File browse input (no capture) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,image/heic,image/heif,.heic,.heif"
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
          data-lightbox-trigger
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
          data-lightbox-trigger
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

      <Dialog open={lightboxOpen} onOpenChange={(open) => { if (!open) closeLightbox(); }}>
        <DialogContent hideDefaultClose className="max-w-2xl bg-black/95 border-none p-2 [&>button]:hidden">
          {/* Close row — sits above the photo in the black area */}
          <div className="flex justify-end pb-1">
            <button
              onClick={closeLightbox}
              className="w-10 h-10 rounded-full bg-white/20 hover:bg-red-600 flex items-center justify-center transition-colors"
              aria-label="Close lightbox"
            >
              <X className="w-6 h-6 text-white" />
            </button>
          </div>
          <div className="flex flex-col items-center gap-4">
            {displayUrl ? (
              <img src={displayUrl} alt="Item photo full size" className="max-w-full max-h-[70vh] object-contain rounded-lg" />
            ) : isOfflinePhoto ? (
              <div className="flex flex-col items-center gap-2 py-8 text-white/60">
                <CloudOff className="w-8 h-8" />
                <p className="text-sm">Photo will load when back online</p>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { closeLightbox(); setCameraOpen(true); }} disabled={disabled || uploading}>
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
