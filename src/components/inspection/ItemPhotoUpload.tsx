import { useState, useRef, useCallback, useEffect, memo } from "react";
import { Camera, X, ImagePlus, Loader2, CloudOff, ImageOff } from "lucide-react";
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
import { photoTrace, newPhotoCid, isPhotoTraceEnabled } from "@/lib/photo-trace";
import { isPhotoTombstoned } from "@/lib/photo-deletion";
import { isLikelyOnline } from "@/lib/network-liveness";



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

  // Close lightbox while keeping the browser history stack clean.
  //
  // Opening pushes a synthetic history entry so OS/browser/swipe Back closes
  // the overlay instead of leaving the report. If the X button merely cleared
  // React state, that synthetic entry would linger; a later Back would pop it
  // and — with the blocker not knowing it's an overlay pop — surface
  // SaveBeforeLeaveDialog falsely.
  //
  // Correct sequence:
  //   1. Leave overlay flag = true (useUnsavedChanges blocker short-circuits).
  //   2. window.history.back() pops the synthetic entry.
  //   3. The popstate listener below runs, clears overlay flag + open state.
  // If no synthetic entry exists (defensive), fall back to direct close.
  const closeLightbox = useCallback(() => {
    if (lightboxHistoryPushedRef.current) {
      // Cleanup finishes in onPopState. Do NOT clear setOverlayActive here.
      window.history.back();
    } else {
      setLightboxOpen(false);
      setOverlayActive(false);
    }
  }, []);

  // Ref to track open state for the popstate handler (avoids stale closures)
  const lightboxOpenRef = useRef(false);

  // Push history state when lightbox opens; listen for popstate to close it
  // (so the hardware/swipe back gesture closes the lightbox instead of
  // navigating away from the report).
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
        setLightboxOpen(false);
        lightboxOpenRef.current = false;
        // Clear overlay flag AFTER state close so the blocker short-circuit
        // covers any navigation queued during the same task.
        setOverlayActive(false);
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

  // [photo-trace] DEV-only: observe external photoUrl prop transitions so we
  // can tell whether the row state was cleared by an outside updater (e.g.
  // result→Pass) vs. by our own onPhotoChange. Tracks previous via ref.
  const prevPhotoUrlPropRef = useRef<string | null>(photoUrl);
  useEffect(() => {
    if (isPhotoTraceEnabled()) {
      const from = prevPhotoUrlPropRef.current;
      const to = photoUrl;
      if (from !== to) {
        photoTrace('props.photoUrl-change', {
          itemId, itemName, section: photoSection, from, to,
        });
        // Rehydration trace: prop arrived (re)populated from outside state
        // (form load, IDB merge, realtime). Captures the scenario where a
        // deleted row photo comes back from cached form data.
        if (to && from !== to) {
          photoTrace('rowPhoto.rehydrated', {
            itemId, itemName, section: photoSection, beforePhoto: from, afterPhoto: to, rawPath: to,
          });
        }
      }
      prevPhotoUrlPropRef.current = to;
    }
  }, [photoUrl, itemId, itemName, photoSection]);

  // Tombstone guard: if the parent re-supplies a photoUrl whose raw storage
  // path was just deleted, suppress it and clear the parent row so the
  // deletion sticks across form rehydration / cached row data.
  useEffect(() => {
    if (!photoUrl || !photoSection || !inspectionId) return;
    if (!isPhotoTombstoned(inspectionId, photoSection, photoUrl)) return;
    if (isPhotoTraceEnabled()) {
      photoTrace('rowPhoto.suppressedByTombstone', {
        itemId, itemName, section: photoSection, beforePhoto: photoUrl, afterPhoto: null, rawPath: photoUrl,
      });
    }
    setLocalPreview(null);
    setSignedUrl(null);
    setIsOfflinePhoto(false);
    onPhotoChange(null);
    onImmediateSave?.();
  }, [photoUrl, photoSection, inspectionId, itemId, itemName, onPhotoChange, onImmediateSave]);

  // [photo-trace] DEV-only: log the render-decision inputs whenever any of
  // the inputs that drive the thumbnail change. This lets us see, at the
  // moment a thumbnail disappears, whether the component fell into the
  // blank-state branch and which input drove it.
  useEffect(() => {
    if (isPhotoTraceEnabled()) {
      const hasPhotoNow = !!(photoUrl || localPreview);
      let branch: 'thumb-with-url' | 'thumb-offline-placeholder' | 'blank-buttons';
      if (hasPhotoNow && (localPreview || signedUrl)) branch = 'thumb-with-url';
      else if (hasPhotoNow && isOfflinePhoto) branch = 'thumb-offline-placeholder';
      else branch = 'blank-buttons';
      photoTrace('render.branch', {
        itemId,
        itemName,
        section: photoSection,
        branch,
        photoUrl,
        hasLocalPreview: !!localPreview,
        hasSignedUrl: !!signedUrl,
        isOfflinePhoto,
      });
    }
  }, [photoUrl, localPreview, signedUrl, isOfflinePhoto, itemId, itemName, photoSection]);


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

      if (!isLikelyOnline()) return;
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
      setIsOfflinePhoto(false);
      retryAttemptsRef.current = 0; // success — refresh auto budget
      return;
    }


    // 2. Stale `pending/...` self-heal: the inspection record may have been
    //    saved before the background upload settled (common on iPad Safari
    //    via mobile hotspot when `navigator.onLine` briefly false-flips and
    //    strands the upload). If the matching IDB photo has since been
    //    marked uploaded with a real storage path, advance the form value
    //    so admins / future loads resolve via the real signed URL instead
    //    of rendering the "Photo will load when back online" placeholder.
    if (photoUrl.startsWith('pending/')) {
      try {
        const { getOfflinePhotos } = await import('@/lib/offline-storage');
        const offline = await getOfflinePhotos(inspectionId);
        const idPrefix = `item-${itemId}-`;
        const healed = offline
          .filter(p => p.id.startsWith(idPrefix)
            && Number(p.uploaded) === 1
            && p.photoUrl
            && !p.photoUrl.startsWith('pending/'))
          .sort((a, b) => {
            const at = (a as { createdAt?: string }).createdAt || '';
            const bt = (b as { createdAt?: string }).createdAt || '';
            return bt.localeCompare(at);
          })[0];
        if (healed?.photoUrl) {
          if (isPhotoTraceEnabled()) {
            photoTrace('loadSignedUrl.pending-self-heal', {
              itemId, from: photoUrl, to: healed.photoUrl,
            });
          }
          onPhotoChange(healed.photoUrl);
          // The prop change will re-trigger loadSignedUrl with the real path.
          return;
        }
      } catch { /* non-critical */ }
    }

    // 3. Offline with no cache — mark as offline photo. Uses the liveness
    //    guard so an iOS Safari false-offline blip does not force a
    //    placeholder over a remote photo we could actually fetch.
    if (!isLikelyOnline()) {
      setIsOfflinePhoto(true);
      return;
    }

    // 3b. Pending placeholder path — no signed URL exists yet on the server.
    // Show the offline-style placeholder thumbnail so the row never falls
    // back to blank upload buttons while the background upload is in flight.
    if (photoUrl.startsWith('pending/')) {
      setIsOfflinePhoto(true);
      return;
    }

    // 3. Fetch signed URL from server
    try {
      const { data } = await supabase.storage
        .from("inspection-photos")
        .createSignedUrl(photoUrl, 3600);
      if (!data?.signedUrl) {
        // Transient: render placeholder thumbnail, not blank buttons.
        setIsOfflinePhoto(true);
        return;
      }
      setSignedUrl(data.signedUrl);
      setIsOfflinePhoto(false);
      retryAttemptsRef.current = 0; // success — refresh auto budget


      // 4. Download blob and cache for offline use
      try {
        const resp = await fetch(data.signedUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          await cachePhotoFromRemote(photoUrl, blob, photoUrl, inspectionId, 'item-photo');
        }
      } catch { /* non-critical */ }
    } catch {
      // Network/Supabase failure — surface a placeholder, not blank buttons.
      setIsOfflinePhoto(true);
    }
  }, [photoUrl, inspectionId, itemId, onPhotoChange]);

  // ------------------------------------------------------------------
  // Bounded signed-URL retry
  // ------------------------------------------------------------------
  // The placeholder thumbnail (CloudOff / ImageOff) is reached whenever
  // loadSignedUrl fails to produce a viewable URL: true offline with no
  // cache, transient createSignedUrl failure, pending/... upload in flight,
  // or — via the <img onError> handler below — an expired/404 signed URL
  // that the browser refused to render.
  //
  // We bound automatic retries so a flaky storage path cannot loop the
  // component against Supabase:
  //   - lastRetryAtRef enforces a 2s gap between any two attempts (covers
  //     online-event chatter, rapid taps, and onError storms).
  //   - retryAttemptsRef caps automatic retries (online / imgError sources)
  //     at 2 per photoUrl lifetime. The initial 'mount' attempt and
  //     user-initiated 'manual' taps do NOT consume the auto budget; manual
  //     is still subject to the debounce.
  //   - retryInFlightRef short-circuits overlapping calls.
  // Budget + clock are reset whenever photoUrl changes (new row / new
  // attached photo) and on successful resolution inside loadSignedUrl.
  const retryAttemptsRef = useRef(0);
  const lastRetryAtRef = useRef(0);
  const retryInFlightRef = useRef(false);

  // Reset retry budget whenever the source-of-truth path changes so a fresh
  // photo never inherits a previous photo's exhausted budget.
  useEffect(() => {
    retryAttemptsRef.current = 0;
    lastRetryAtRef.current = 0;
  }, [photoUrl]);

  const handleRetry = useCallback(
    async (source: 'mount' | 'online' | 'imgError' | 'manual') => {
      if (retryInFlightRef.current) return;

      const now = Date.now();
      // Initial mount (lastRetryAt === 0) is exempt from the debounce so the
      // first load is never accidentally suppressed.
      if (lastRetryAtRef.current !== 0 && now - lastRetryAtRef.current < 2000) {
        return;
      }
      if ((source === 'online' || source === 'imgError') && retryAttemptsRef.current >= 2) {
        return;
      }

      retryInFlightRef.current = true;
      lastRetryAtRef.current = now;
      if (source === 'online' || source === 'imgError') {
        retryAttemptsRef.current += 1;
      }
      try {
        await loadSignedUrl();
      } finally {
        retryInFlightRef.current = false;
      }
    },
    [loadSignedUrl],
  );

  // Initial load — funneled through handleRetry so it shares the same
  // in-flight guard. The debounce exempts the very first attempt
  // (lastRetryAtRef starts at 0), so mount is never suppressed.
  useEffect(() => { handleRetry('mount'); }, [handleRetry]);

  // Retry once when the browser flips back online and the photo is still
  // unresolved. Bounded by the retry budget above.
  useEffect(() => {
    if (isOnline && isOfflinePhoto && photoUrl) {
      handleRetry('online');
    }
  }, [isOnline, isOfflinePhoto, photoUrl, handleRetry]);


  /**
   * Fire-and-forget background upload — does NOT block UI
   */
  const uploadInBackground = useCallback(async (
    photoId: string,
    compressed: File,
    userId: string,
    filePath: string,
    cid?: string,
  ) => {
    try {
      if (isPhotoTraceEnabled()) photoTrace('uploadInBackground.enter', { photoId, filePath, inspectionId, photoSection }, cid);
      // DB rows for item photos require a real UUID inspection_id.
      // If this report is still temp/local, keep the photo queued for sync.
      if (photoSection && inspectionId.startsWith('temp-')) {
        throw new Error('Inspection still has a temporary ID; deferring item photo sync');
      }

      // Zero-byte guard #2 (pre-upload). Defense in depth: even if a
      // 0-byte blob somehow reached IDB (legacy row, eviction race), do
      // not push it to Storage. Throwing leaves the photo with
      // uploaded=0 so useAutoSync will retry under the (now non-empty)
      // gate later, instead of silently writing an empty object that
      // markPhotoAsUploaded would then immortalise.
      if (!compressed || compressed.size === 0) {
        if (isPhotoTraceEnabled()) photoTrace('uploadInBackground.zero-byte-skip', { photoId, filePath }, cid);
        throw new Error('Refusing to upload empty photo blob');
      }

      const { error: uploadError } = await supabase.storage
        .from("inspection-photos")
        .upload(filePath, compressed, { contentType: "image/jpeg", upsert: true });

      if (uploadError) throw uploadError;
      if (isPhotoTraceEnabled()) photoTrace('uploadInBackground.storage-uploaded', { filePath }, cid);

      // Zero-byte guard #3 (post-upload integrity check). Even with the
      // two upstream gates, a HEAD-back is the only way to be certain
      // the body landed. If the remote object is 0 bytes, throw before
      // markPhotoAsUploaded so the photo stays queued for retry rather
      // than getting locked in as "done" with empty contents.
      try {
        const headRes = await fetch(
          (await supabase.storage.from('inspection-photos').createSignedUrl(filePath, 60)).data?.signedUrl || '',
          { method: 'HEAD' },
        );
        const remoteLen = Number(headRes.headers.get('content-length') || '0');
        if (!headRes.ok || remoteLen === 0) {
          if (isPhotoTraceEnabled()) photoTrace('uploadInBackground.empty-after-upload', { filePath, remoteLen, status: headRes.status }, cid);
          throw new Error(`Uploaded object is ${remoteLen} bytes (expected > 0)`);
        }
      } catch (verifyErr) {
        // Bubble up — keep photo unmarked so useAutoSync retries.
        throw verifyErr;
      }

      // ✅ Mark uploaded FIRST to close race window with syncPhotos
      await markPhotoAsUploaded(photoId, filePath);
      if (isPhotoTraceEnabled()) photoTrace('uploadInBackground.markUploaded', { photoId }, cid);

      // Insert into gallery if applicable
      if (photoSection) {
        // Dedup guard: skip insert if a row already exists for this photo_url + inspection_id
        const { data: existing } = await supabase.from('inspection_photos')
          .select('id')
          .eq('photo_url', filePath)
          .eq('inspection_id', inspectionId)
          .is('deleted_at', null)
          .maybeSingle();
        if (isPhotoTraceEnabled()) photoTrace('uploadInBackground.gallery-existing', { existingId: existing?.id ?? null, filePath }, cid);

        if (!existing) {
          const caption = (itemNameRef.current || itemName || '').trim() || 'Item photo';
          const { error: galleryError } = await supabase.from('inspection_photos').insert({
            inspection_id: inspectionId,
            photo_url: filePath,
            photo_section: photoSection,
            caption,
          });
          if (isPhotoTraceEnabled()) photoTrace('uploadInBackground.gallery-insert', { caption, err: galleryError?.message ?? null }, cid);

          if (galleryError) throw galleryError;
        }
        onGalleryRefresh?.();
      }

      // Update signed URL for display
      const { data: signedData } = await supabase.storage
        .from("inspection-photos")
        .createSignedUrl(filePath, 3600);
      let revokedPreview = false;
      if (signedData?.signedUrl) {
        setSignedUrl(signedData.signedUrl);
        setLocalPreview(prev => {
          if (prev) { URL.revokeObjectURL(prev); revokedPreview = true; }
          return null;
        });
      }
      if (isPhotoTraceEnabled()) photoTrace('uploadInBackground.signedUrl-set', { hasSignedUrl: !!signedData?.signedUrl, revokedPreview }, cid);

      if (import.meta.env.DEV) {
        console.log('[ItemPhotoUpload] Background upload completed:', photoId);
      }
    } catch (error) {
      if (isPhotoTraceEnabled()) photoTrace('uploadInBackground.failed', { err: String((error as any)?.message ?? error) }, cid);
      // Photo remains in IndexedDB with uploaded=false — useAutoSync will retry
      console.warn('[ItemPhotoUpload] Background upload failed, queued for later:', error);

    }
  }, [inspectionId, photoSection, itemName, onGalleryRefresh]);

  const handleUpload = useCallback(async (file: File) => {
    // [photo-trace] correlation id for this user-initiated photo action
    const cid = isPhotoTraceEnabled() ? newPhotoCid(itemId) : '';
    if (isPhotoTraceEnabled()) {
      photoTrace('handleUpload.enter', {
        itemId, itemName, section: photoSection, inspectionId,
        oldPhotoUrl: photoUrl,
        fileSize: file?.size, fileType: file?.type, fileName: (file as any)?.name,
      }, cid);
    }
    // Defensive: reject a zero-byte File before we touch any persistence
    // layer. The in-app camera dialog occasionally produces a 0-byte File
    // on iOS Safari when the canvas-toBlob race loses; without this guard
    // the row thumbnail showed a blob: preview that never made it into
    // the bottom gallery (because no blob was ever cached).
    if (!file || file.size === 0) {
      if (isPhotoTraceEnabled()) photoTrace('handleUpload.zero-byte-reject', { itemId }, cid);
      toast.error("Photo capture failed", {
        description: "The camera returned an empty image. Please try again.",
      });
      return;
    }


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
      if (isPhotoTraceEnabled()) photoTrace('handleUpload.compressed', { size: compressed.size, type: compressed.type }, cid);

      // Zero-byte guard #1 (post-compression). Mirrors the input-file guard
      // above. Without this, a Safari canvas-toBlob hiccup that returns an
      // empty Blob would happily flow through to IDB and then to Storage —
      // leaving a 0-byte object on the server that renders as a broken
      // image in the report (the "place marker" bug observed on
      // Peaceable Kingdom). Bailing here keeps the inspection_photos row
      // out of existence entirely so a retry/recapture starts clean.
      if (!compressed || compressed.size === 0) {
        if (isPhotoTraceEnabled()) photoTrace('handleUpload.zero-byte-compressed', { itemId }, cid);
        clearTimeout(safetyTimer);
        setUploading(false);
        toast.error("Photo capture failed", {
          description: "The compressed image was empty. Please try again.",
        });
        return;
      }

      // 2. Instant local preview
      const previewUrl = URL.createObjectURL(compressed);
      setLocalPreview(previewUrl);
      if (isPhotoTraceEnabled()) photoTrace('handleUpload.localPreview-created', { previewUrl }, cid);


      // 3. Generate UNIQUE file path per upload. Replacement uploads to the
      //    same item used to reuse `items/<itemId>.jpg`, so a second upload
      //    overwrote the first in storage AND collided with the existing
      //    inspection_photos row (uploadInBackground.gallery-existing).
      //    PhotoGallery then deduped the new photo against the stale DB row,
      //    surfacing the prior image under the new label. Per-upload uuid
      //    suffix guarantees a distinct storage path / DB row identity.
      const uploadTs = Date.now();
      const uploadSuffix = `${uploadTs}-${Math.random().toString(36).slice(2, 8)}`;
      const photoId = `item-${itemId}-${uploadTs}`;
      const placeholderPath = `pending/${inspectionId}/items/${itemId}-${uploadSuffix}.jpg`;
      const deviceFileName = `RopeWorks_${photoSection || 'item'}_${uploadTs}.jpg`;
      const previousPhotoUrl = photoUrl; // capture before any state mutation
      if (isPhotoTraceEnabled()) photoTrace('handleUpload.placeholder', { photoId, placeholderPath, caption: captionFromName, replacing: previousPhotoUrl }, cid);

      // Shared offline-save invocation (used for the initial attempt + one retry)
      const tryOfflineSave = () => savePhotoOffline({
        id: photoId,
        inspectionId,
        section: photoSection || 'item-photo',
        blob: compressed,
        fileName: `${itemId}-${uploadSuffix}.jpg`,
        uploaded: false,
        photoUrl: placeholderPath,
        tableName: 'inspection_photos',
        storageBucket: 'inspection-photos',
        foreignKeyColumn: 'inspection_id',
        caption: captionFromName,
      });

      // 3b. Replacement: soft-delete the previous photo's gallery row +
      //    offline IDB record so the bottom gallery converges on the new
      //    upload instead of showing both (or worse, only the stale one).
      //    Best-effort; never blocks the new upload.
      if (previousPhotoUrl && previousPhotoUrl !== placeholderPath) {
        try {
          const now = new Date();
          const retentionDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
          if (photoSection && inspectionId && !inspectionId.startsWith('temp-') && !previousPhotoUrl.startsWith('pending/')) {
            supabase.from('inspection_photos')
              .update({ deleted_at: now.toISOString(), retention_until: retentionDate.toISOString() })
              .eq('photo_url', previousPhotoUrl)
              .eq('inspection_id', inspectionId)
              .is('deleted_at', null)
              .then(() => { /* no-op */ });
          }
          // Soft-clear offline rows pointing at the prior URL
          import('@/lib/offline-storage').then(async (m) => {
            try {
              const offline = await m.getOfflinePhotos(inspectionId);
              for (const p of offline) {
                if (p.photoUrl === previousPhotoUrl && p.section === (photoSection || 'item-photo')) {
                  await m.deleteOfflinePhoto(p.id).catch(() => {});
                }
              }
            } catch { /* non-critical */ }
          }).catch(() => {});
          if (isPhotoTraceEnabled()) photoTrace('handleUpload.replaced-prior', { previousPhotoUrl }, cid);
        } catch { /* non-critical */ }
      }

      // 4. Circuit breaker pre-check — skip IDB if it's known-dead
      const cbStatus = getCircuitBreakerStatus();
      if (cbStatus.open) {
        if (isPhotoTraceEnabled()) photoTrace('handleUpload.circuitBreakerOpen', {}, cid);
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
        if (isPhotoTraceEnabled()) photoTrace('handleUpload.onPhotoChange', { newPhotoUrl: placeholderPath, branch: 'breaker-open' }, cid);
        onImmediateSave?.();
        toast.success("Photo saved to backup storage", {
          description: "Will sync when storage recovers",
        });
        return; // skip IDB entirely
      }

      // 5. LOCAL-FIRST: Save to IndexedDB (one retry on failure)
      let saved = await tryOfflineSave();
      if (isPhotoTraceEnabled()) photoTrace('handleUpload.idb-save', { attempt: 1, saved }, cid);
      if (!saved) {
        // brief backoff then one retry — covers transient quota/lock races
        await new Promise(r => setTimeout(r, 150));
        saved = await tryOfflineSave();
        if (isPhotoTraceEnabled()) photoTrace('handleUpload.idb-save', { attempt: 2, saved }, cid);
      }

      // 6. Save receipt (always, regardless of IDB success)
      savePhotoReceipt({
        id: photoId,
        inspectionId,
        section: photoSection || 'item-photo',
        timestamp: Date.now(),
        uploaded: false,
      });

      if (!saved) {
        // Both durable paths failed. Per the contract: do NOT leave a
        // misleading row-only thumbnail that vanishes on reopen. Clear
        // the optimistic preview, do not call onPhotoChange, and surface
        // a clear error. Photo bytes are still pushed to the device
        // download/share path so the user has an unrecoverable copy.
        if (isPhotoTraceEnabled()) photoTrace('handleUpload.idb-failed-clear-preview', {}, cid);
        console.warn('[ItemPhotoUpload] IDB save failed after retry — refusing to attach');
        saveToDevice(compressed, deviceFileName);
        URL.revokeObjectURL(previewUrl);
        setLocalPreview(null);
        toast.error("Could not attach photo to report", {
          description: "Your device storage may be full. The image was downloaded to your device — please retry.",
          duration: 8000,
        });
        return;
      }

      // Save photo to device's local storage — fire-and-forget
      saveToDevice(compressed, deviceFileName);

      // ✅ Immediately refresh gallery
      onGalleryRefresh?.();

      // 7. Update form state immediately
      onPhotoChange(placeholderPath);
      if (isPhotoTraceEnabled()) photoTrace('handleUpload.onPhotoChange', { newPhotoUrl: placeholderPath, branch: 'placeholder' }, cid);
      onImmediateSave?.();

      // 8. Background upload if online.
      //    iPad/hotspot handoffs briefly flip navigator.onLine to false even
      //    while requests succeed; trust the liveness guard (30s grace) as a
      //    fallback so a newly captured photo still kicks off its background
      //    upload instead of being stranded as `pending/...` until the next
      //    online event (which on iPad Safari may never re-fire in the
      //    current tab). useAutoSync would eventually retry, but starting
      //    immediately is what the user observed as broken.
      if (isOnline || isLikelyOnline()) {
        toast.info("Syncing photo...");
        getUserWithCache()
          .then(async (user) => {
            if (user?.id) {
              const realPath = `${user.id}/${inspectionId}/items/${itemId}-${uploadSuffix}.jpg`;
              await updatePhotoPath(photoId, realPath);
              onPhotoChange(realPath);
              if (isPhotoTraceEnabled()) photoTrace('handleUpload.onPhotoChange-realPath', { realPath }, cid);
              uploadInBackground(photoId, compressed, user.id, realPath, cid).catch(() => {});
            }
          })
          .catch(() => {});
      } else {
        toast.success("Photo saved locally", {
          description: "Will sync when back online",
        });
      }
    } catch (err: any) {
      if (isPhotoTraceEnabled()) photoTrace('handleUpload.error', { err: String(err?.message ?? err) }, cid);
      console.error("[ItemPhotoUpload] Save failed:", err);
      toast.error(err?.message || "Failed to save photo");
      setLocalPreview(null);
    } finally {
      clearTimeout(safetyTimer);
      setUploading(false);
    }
  }, [itemId, inspectionId, onPhotoChange, onImmediateSave, photoSection, isOnline, uploadInBackground, itemName, onGalleryRefresh, photoUrl]);


  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = "";
  }, [handleUpload]);

  const handleRemove = useCallback(async () => {
    const beforePhoto = photoUrl;
    if (isPhotoTraceEnabled()) {
      photoTrace('handleRemove', { itemId, itemName, section: photoSection, photoUrlAtRemove: beforePhoto });
      photoTrace('rowPhoto.clear.requested', {
        itemId, itemName, section: photoSection, beforePhoto, afterPhoto: null, rawPath: beforePhoto,
      });
    }
    // Always run the converged delete when we know which item + section +
    // inspection this is, even if the row's local `photoUrl` is already null
    // or stale. The item-scoped fallback inside deletePhotoEverywhere will
    // soft-delete + tombstone any active inspection_photos row whose
    // photo_url contains `items/${itemId}-…` so the bottom gallery converges
    // with the row even when the form's photoUrl diverged from the DB's
    // photo_url (placeholder vs realPath, or already-cleared form state).
    if (photoSection && inspectionId && itemId) {
      try {
        const { deletePhotoEverywhere } = await import('@/lib/photo-deletion');
        const res = await deletePhotoEverywhere({
          inspectionId,
          section: photoSection,
          rawStoragePath: photoUrl,
          itemIdScope: itemId,
        });
        if (isPhotoTraceEnabled()) {
          photoTrace('rowPhoto.clear.delete-result', {
            itemId, itemName, section: photoSection,
            rawPath: photoUrl,
            dbMatched: res.dbResult.matched,
            dbOk: res.dbResult.ok,
            dbError: res.dbResult.error,
            idbRemoved: res.idbRemoved,
            tombstoned: res.tombstoned,
            scopedMatchedPaths: res.scopedMatchedPaths,
          });
        }
      } catch (err: any) {
        if (isPhotoTraceEnabled()) {
          photoTrace('rowPhoto.clear.delete-error', {
            itemId, itemName, section: photoSection, rawPath: photoUrl,
            err: String(err?.message ?? err),
          });
        }
      }
      onGalleryRefresh?.();
    }
    setLocalPreview(null);
    setSignedUrl(null);
    setIsOfflinePhoto(false);
    onPhotoChange(null);
    if (isPhotoTraceEnabled()) {
      photoTrace('handleRemove.onPhotoChange', { newPhotoUrl: null, itemId });
      photoTrace('rowPhoto.clear.applied', {
        itemId, itemName, section: photoSection, beforePhoto, afterPhoto: null, rawPath: beforePhoto,
      });
    }
    onImmediateSave?.();
    closeLightbox();
  }, [photoUrl, onPhotoChange, onImmediateSave, photoSection, inspectionId, onGalleryRefresh, closeLightbox, itemId, itemName]);


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
          <img
            src={displayUrl}
            alt="Item photo"
            className="w-full h-full object-cover"
            onError={() => {
              // Expired or 404 signed URL — fall back to the controlled
              // placeholder branch instead of the browser broken-image
              // glyph, then attempt one bounded retry. We deliberately do
              // NOT setIsOfflinePhoto(true) here: the render decision
              // below is driven by `isOnline` + `displayUrl`, so an
              // online-but-broken image surfaces the ImageOff/retry UI,
              // never the CloudOff/offline copy.
              if (prevObjectUrlRef.current) {
                URL.revokeObjectURL(prevObjectUrlRef.current);
                prevObjectUrlRef.current = null;
              }
              setSignedUrl(null);
              handleRetry('imgError');
            }}
          />
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
      ) : hasPhoto ? (
        // photoUrl exists but neither a signed URL nor a local preview is
        // ready yet. Two visual variants — true offline vs online-unresolved
        // — both keep the row from collapsing back to blank upload buttons.
        // The split is driven by `isOnline` (not by `isOfflinePhoto`, which
        // is also set on transient online failures) so an online broken /
        // expired thumbnail never gets mislabeled as offline.
        !isOnline ? (
          <button
            data-lightbox-trigger
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="relative w-12 h-12 rounded-md overflow-hidden border border-border bg-muted flex items-center justify-center"
            disabled={disabled}
            title="Offline — photo will load when back online"
            aria-label="Offline — photo will load when back online"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            ) : (
              <CloudOff className="w-5 h-5 text-muted-foreground" />
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // Tap retries the signed-URL fetch through the bounded
              // helper. Never opens the lightbox — an unresolved online
              // thumbnail has no displayUrl to show.
              handleRetry('manual');
            }}
            className="relative w-12 h-12 rounded-md overflow-hidden border border-border bg-muted flex items-center justify-center hover:border-primary transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={disabled}
            title="Photo unavailable — tap to retry"
            aria-label="Photo unavailable — tap to retry"
          >
            {uploading || retryInFlightRef.current ? (
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            ) : (
              <ImageOff className="w-5 h-5 text-muted-foreground" />
            )}
          </button>
        )
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
