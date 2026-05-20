import { useEffect, useState, useRef, useCallback } from "react";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { supabase } from "@/integrations/supabase/client";
import { getOfflinePhotos, updatePhotoDisplayOrder, getDB, putPhotoRecord, isIdbLayerBreakerOpen, getCircuitBreakerStatus } from "@/lib/offline-storage";
import { cachePhotoFromRemote, batchValidateCachedPhotos } from "@/lib/photo-cache";
import { getPhotoReceipts } from "@/lib/photo-receipts";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { isHeicPath, isHeicBlob, convertHeicBlobToJpeg } from "@/lib/heic-converter";
import { processBackgroundCacheItem, migrateHeicToJpeg, type MigrateHeicOutcome } from "./photo-gallery-helpers";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Cloud, CloudOff, Loader2, AlertTriangle, CheckSquare, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";
import { setOverlayActive } from "@/lib/navigation";
import { toast } from "sonner";
import PhotoCaptionInput from "./PhotoCaptionInput";
import { DraggablePhotoItem } from "./DraggablePhotoItem";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  rectSortingStrategy,
} from "@dnd-kit/sortable";

import { isPhotoTraceEnabled } from "@/lib/photo-trace";
type PhotoTableName = "inspection_photos" | "training_photos" | "daily_assessment_photos";

interface PhotoGalleryProps {
  inspectionId: string;
  section: string;
  readOnly?: boolean;
  tableName?: PhotoTableName;
  foreignKeyColumn?: string;
  storageBucket?: string;
}

interface Photo {
  id: string;
  photoUrl: string;
  blob?: Blob;
  uploaded: boolean;
  caption: string | null;
  display_order: number;
  staleUpload?: boolean;
  /** True if a receipt exists but the blob was evicted from IndexedDB */
  blobEvicted?: boolean;
  /** True if the original file is HEIC/HEIF and needs client-side conversion for display */
  isHeic?: boolean;
}

export default function PhotoGallery({ 
  inspectionId, 
  section, 
  readOnly = false,
  tableName = "inspection_photos",
  foreignKeyColumn = "inspection_id",
  storageBucket = "inspection-photos",
}: PhotoGalleryProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { isOnline } = useNetworkStatus();
  const objectUrlsRef = useRef<string[]>([]);
  const [evictedCount, setEvictedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  // Preserve last-known rendered list so a transient IDB read failure (or a
  // breaker-open fast-fail returning []) does not flicker pending photos out
  // of the gallery. Updated only after a successful load.
  const lastKnownPhotosRef = useRef<Photo[]>([]);

  // Batch selection state
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Confirmation dialog state
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'single'; photo: Photo } | { type: 'batch' } | null>(null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const selectedPhoto = selectedPhotoIndex !== null ? photos[selectedPhotoIndex] ?? null : null;

  const goToPrev = useCallback(() => {
    setSelectedPhotoIndex(prev => prev !== null ? (prev === 0 ? photos.length - 1 : prev - 1) : null);
  }, [photos.length]);

  const goToNext = useCallback(() => {
    setSelectedPhotoIndex(prev => prev !== null ? (prev === photos.length - 1 ? 0 : prev + 1) : null);
  }, [photos.length]);

  // Track whether we pushed a history entry for the lightbox
  const lightboxHistoryPushedRef = useRef(false);

  // Close lightbox while keeping browser history stack clean. See matching
  // explanation in ItemPhotoUpload.closeLightbox — overlay flag stays true
  // across the synthetic history.back() so useUnsavedChanges short-circuits;
  // the popstate listener finishes cleanup.
  const closeLightbox = useCallback(() => {
    if (lightboxHistoryPushedRef.current) {
      window.history.back();
    } else {
      setSelectedPhotoIndex(null);
      setOverlayActive(false);
    }
  }, []);

  // Ref to track open state for the popstate handler (avoids stale closures)
  const lightboxOpenRef = useRef(false);

  // Push history state when lightbox opens; listen for popstate to close it
  useEffect(() => {
    const isOpen = selectedPhotoIndex !== null;
    lightboxOpenRef.current = isOpen;

    if (isOpen && !lightboxHistoryPushedRef.current) {
      window.history.pushState({ lightbox: true }, '');
      lightboxHistoryPushedRef.current = true;
      setOverlayActive(true);
    }

    const onPopState = () => {
      if (lightboxOpenRef.current) {
        lightboxHistoryPushedRef.current = false;
        setSelectedPhotoIndex(null);
        lightboxOpenRef.current = false;
        // Clear overlay flag AFTER state close (mirrors ItemPhotoUpload).
        setOverlayActive(false);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [selectedPhotoIndex !== null]); // only on open/close transitions

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (selectedPhotoIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); goToPrev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goToNext(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedPhotoIndex, goToPrev, goToNext]);

  // Desktop-first sensor configuration with mobile support
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  /**
   * Audit H2: migrate a freshly-converted HEIC blob to a real `.jpg`
   * storage path, update the DB row, and patch the IDB photo cache so
   * future loads stop re-converting. Replaces the previous
   * `reuploadConvertedJpeg` which wrote JPEG bytes back to the SAME
   * `.heic` path and never touched the DB — every gallery load re-
   * fetched + re-converted + re-uploaded forever.
   *
   * See `migrateHeicToJpeg` in `./photo-gallery-helpers` for the
   * multi-step write order and error semantics.
   */
  const reuploadConvertedJpeg = (filePath: string, jpegBlob: Blob): void => {
    void migrateHeicToJpeg({
      photoId: '',
      oldStoragePath: filePath,
      jpegBlob,
      storageUploadJpeg: async (path, blob) => {
        const res = await supabase.storage
          .from(storageBucket)
          .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        return { error: res.error ?? null };
      },
      storageRemoveOld: async (path) => {
        const res = await supabase.storage.from(storageBucket).remove([path]);
        return { error: res.error ?? null };
      },
      dbUpdatePhotoUrl: async () => ({ error: null }),
      idbUpdatePhotoUrl: async () => undefined,
    });
  };

  /**
   * Audit H2: rich variant used from the background-cache loop where we
   * have the full photo row in hand. Updates storage + the DB row + the
   * IDB cache entry, all keyed off `photo.id`.
   */
  const migrateConvertedJpegForPhoto = async (
    photoId: string,
    oldStoragePath: string,
    jpegBlob: Blob
  ): Promise<MigrateHeicOutcome> => {
    return migrateHeicToJpeg({
      photoId,
      oldStoragePath,
      jpegBlob,
      storageUploadJpeg: async (path, blob) => {
        const res = await supabase.storage
          .from(storageBucket)
          .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        return { error: res.error ?? null };
      },
      storageRemoveOld: async (path) => {
        const res = await supabase.storage.from(storageBucket).remove([path]);
        return { error: res.error ?? null };
      },
      dbUpdatePhotoUrl: async (id, newPath) => {
        const res = await (supabase as unknown as {
          from: (t: string) => {
            update: (p: Record<string, string>) => {
              eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
            };
          };
        })
          .from(tableName)
          .update({ photo_url: newPath })
          .eq('id', id);
        return { error: res.error ?? null };
      },
      idbUpdatePhotoUrl: async (id, newPath) => {
        const db = await getDB();
        const photo = await db.get('photos', id);
        if (!photo) return;
        photo.photoUrl = newPath;
        photo.fileName = newPath.split('/').pop() || photo.fileName;
        await putPhotoRecord(db, photo);
      },
    });
  };

  const initialLoadDone = useRef(false);

  const loadPhotos = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      let signedUrlFailures = 0;
      const newObjectUrls: string[] = [];

      // Photo persistence guard: if the IDB layer/circuit breaker is open,
      // `getOfflinePhotos` will silently return [] (silent boundary).
      // Re-rendering empty would make pending uploads visually disappear
      // even though the blob is still safely on disk. Preserve the last-
      // known list and skip this refresh — a future tick will retry.
      const breakerOpen = isIdbLayerBreakerOpen() || getCircuitBreakerStatus().open;
      if (breakerOpen && lastKnownPhotosRef.current.length > 0) {
        if (import.meta.env.DEV) {
          console.warn('[PhotoGallery] IDB breaker open — preserving last-known photo list');
        }
        if (!silent) setLoading(false);
        initialLoadDone.current = true;
        return;
      }

      const offlinePhotos = await getOfflinePhotos(inspectionId);
      const STALE_THRESHOLD_MS = 10 * 60 * 1000;
      const now = Date.now();
      const offlinePhotosList: Photo[] = offlinePhotos
        .filter(p => p.section === section && p.blob != null)
        .map((p, index) => {
          try {
            const objectUrl = URL.createObjectURL(p.blob);
            newObjectUrls.push(objectUrl);
            const createdAt = (p as any).createdAt || (p as any).created_at;
            const isStale = !p.uploaded && createdAt && (now - new Date(createdAt).getTime() > STALE_THRESHOLD_MS);
            return {
              id: p.id,
              photoUrl: objectUrl,
              rawStoragePath: p.photoUrl || '', // preserve raw storage path for dedup
              blob: p.blob,
              uploaded: Boolean(p.uploaded),
              // Prefer the caption written at capture time (ItemPhotoUpload
              // passes the live item name into savePhotoOffline). This keeps
              // pre-sync offline photos labeled with the correct item name
              // in the bottom gallery. The existing rename-sync effect in
              // ItemPhotoUpload still updates this caption on subsequent
              // renames; the *last write wins* — i.e. the current item
              // name at the most recent rename-sync tick, NOT the
              // capture-time snapshot if the item has since been renamed.
              caption: (p as any).caption ?? null,
              display_order: p.display_order ?? index,
              staleUpload: isStale,
            };
          } catch (e) {
            console.warn('[PhotoGallery] Skipping photo with invalid blob:', p.id, e);
            return null;
          }
        })
        .filter(Boolean) as (Photo & { rawStoragePath?: string })[];

      const receipts = getPhotoReceipts(inspectionId, section);
      const offlinePhotoIds = new Set(offlinePhotos.filter(p => p.section === section).map(p => p.id));
      const evictedPhotos = receipts.filter(r => !r.uploaded && !offlinePhotoIds.has(r.id));
      setEvictedCount(evictedPhotos.length);

      if (isOnline) {
      const { data, error } = await (supabase
          .from(tableName) as any)
          .select('*')
          .eq(foreignKeyColumn, inspectionId)
          .eq('photo_section', section)
          .is('deleted_at', null)
          .order('display_order', { ascending: true });

        if (error) throw error;

        const supabasePhotoIds = (data || []).map((p: any) => p.id);
        const validCacheIds = await batchValidateCachedPhotos(supabasePhotoIds);

        // Split photos into cached (instant) vs uncached (need signed URLs)
        const allPhotos = (data || []) as any[];
        const cachedPhotos: Photo[] = [];
        const uncachedPhotos: { photo: any; index: number }[] = [];

        for (let i = 0; i < allPhotos.length; i++) {
          const photo = allPhotos[i];
          const existingOfflinePhoto = offlinePhotos.find(p => p.photoUrl === photo.photo_url);

          if (existingOfflinePhoto?.blob && validCacheIds.has(photo.id)) {
            const objectUrl = URL.createObjectURL(existingOfflinePhoto.blob);
            newObjectUrls.push(objectUrl);
            cachedPhotos.push({
              id: photo.id,
              photoUrl: objectUrl,
              blob: existingOfflinePhoto.blob,
              uploaded: true,
              caption: photo.caption,
              display_order: photo.display_order ?? i,
            });
          } else {
            uncachedPhotos.push({ photo, index: i });
          }
        }

        // Single batch call for all uncached photos
        let batchPhotos: Photo[] = [];
        if (uncachedPhotos.length > 0) {
          const paths = uncachedPhotos.map(u => u.photo.photo_url);
          const { data: signedUrlsData, error: batchError } = await supabase.storage
            .from(storageBucket)
            .createSignedUrls(paths, 3600);

          if (batchError) {
            console.error('[PhotoGallery] Batch signed URL generation failed:', batchError);
            signedUrlFailures = uncachedPhotos.length;
          } else {
            batchPhotos = (signedUrlsData || [])
              .map((urlData, idx) => {
                const { photo, index } = uncachedPhotos[idx];
                if (urlData.error || !urlData.signedUrl) {
                  console.error(`[PhotoGallery] Failed signed URL for photo ${photo.id}:`, urlData.error);
                  signedUrlFailures++;
                  return null;
                }
                return {
                  id: photo.id,
                  photoUrl: urlData.signedUrl,
                  uploaded: true,
                  caption: photo.caption,
                  display_order: photo.display_order ?? index,
                } as Photo;
              })
              .filter((p): p is Photo => p !== null);

            // Background-cache all fetched photos in one idle callback
            const cacheWork = (signedUrlsData || [])
              .map((urlData, idx) => ({ urlData, photo: uncachedPhotos[idx].photo }))
              .filter(w => w.urlData.signedUrl && !w.urlData.error);

            const doCaching = () => {
              for (const { urlData, photo } of cacheWork) {
                fetch(urlData.signedUrl!)
                  .then(r => { if (r.ok) return r.blob(); throw new Error('fetch failed'); })
                  .then(blob => processBackgroundCacheItem({
                    blob,
                    photoId: photo.id,
                    photoStoragePath: photo.photo_url,
                    inspectionId,
                    section,
                    isHeicPath,
                    isHeicBlob,
                    convertHeicBlobToJpeg,
                    reuploadConvertedJpeg: (path, jpegBlob) => {
                      // Audit H2: rich migrate (storage + DB + IDB).
                      void migrateConvertedJpegForPhoto(photo.id, path, jpegBlob)
                        .then(outcome => {
                          if (outcome.kind === 'failed-upload') {
                            console.warn(
                              '[PhotoGallery] HEIC migrate: storage upload failed',
                              photo.id,
                              outcome.error
                            );
                          } else if (outcome.kind === 'failed-db-update') {
                            console.warn(
                              '[PhotoGallery] HEIC migrate: DB update failed (storage already at',
                              outcome.newStoragePath + ')',
                              photo.id,
                              outcome.error
                            );
                          } else if (outcome.kind === 'failed-idb-update') {
                            console.warn(
                              '[PhotoGallery] HEIC migrate: IDB update failed (storage+DB already at',
                              outcome.newStoragePath + ')',
                              photo.id
                            );
                          } else if (outcome.kind === 'migrated' && import.meta.env.DEV) {
                            console.log(
                              '[PhotoGallery] HEIC migrate: ok',
                              photo.id,
                              '→',
                              outcome.newStoragePath
                            );
                          }
                        })
                        .catch(e => console.warn('[PhotoGallery] HEIC migrate error:', e));
                    },
                    cachePhotoFromRemote,
                  }))
                  .then(outcome => {
                    if (outcome?.kind === 'skipped-heic-conversion-failed') {
                      // Audit H1: HEIC conversion failed (heic2any threw or
                      // timed out). The helper deliberately did NOT cache
                      // the raw HEIC blob — caching would render as a black
                      // placeholder on iOS Safari for any future <img
                      // src={blob:…}>. The next loadPhotos() will re-fetch
                      // from the signed URL and retry conversion.
                      console.warn(
                        '[PhotoGallery] HEIC conversion failed; cache skipped to avoid black-placeholder render',
                        photo.id
                      );
                    }
                  })
                  .catch(e => console.warn('[PhotoGallery] Background cache failed:', e));
              }
            };
            if (typeof requestIdleCallback === 'function') {
              requestIdleCallback(doCaching);
            } else {
              setTimeout(doCaching, 100);
            }
          }
        }


        const supabasePhotos: Photo[] = [...cachedPhotos, ...batchPhotos];

        const pendingPhotos = offlinePhotosList.filter(p => !p.uploaded);
        // Dedup: filter out offline photos whose raw storage path already exists in DB results
        // Use raw DB photo_url paths (not signed/object URLs) for reliable comparison
        const dbStoragePaths = new Set((data || []).map((p: any) => p.photo_url));
        const droppedByDedup: Array<{ id: string; rawStoragePath: string; caption: string | null }> = [];
        const dedupedPending = pendingPhotos.filter(p => {
          const rawPath = (p as any).rawStoragePath || '';
          const drop = dbStoragePaths.has(rawPath);
          if (drop && isPhotoTraceEnabled()) {
            droppedByDedup.push({ id: p.id, rawStoragePath: rawPath, caption: p.caption });
          }
          return !drop;
        });
        const mergedPhotos = [...dedupedPending, ...supabasePhotos].sort(
          (a, b) => a.display_order - b.display_order
        );

        if (isPhotoTraceEnabled()) {
          const trace = {
            ts: Date.now(),
            event: 'PhotoGallery.load',
            inspectionId,
            section,
            dbRows: (data || []).map((p: any) => ({ id: p.id, photo_url: p.photo_url, caption: p.caption, display_order: p.display_order })),
            offlineRows: offlinePhotosList.map(p => ({ id: p.id, rawStoragePath: (p as any).rawStoragePath, caption: p.caption, uploaded: p.uploaded, display_order: p.display_order })),
            droppedByDedup,
            finalRows: mergedPhotos.map(p => ({ id: p.id, photoUrl: p.photoUrl.startsWith('blob:') ? 'blob:…' : p.photoUrl, caption: p.caption, uploaded: p.uploaded, display_order: p.display_order })),
            signedUrlFailures,
          };
          // eslint-disable-next-line no-console
          console.debug('[photo-trace PhotoGallery.load]', trace);
          try {
            (window as any).__photoTrace = (window as any).__photoTrace || [];
            (window as any).__photoTrace.push(trace);
          } catch { /* ignore */ }
        }

        const oldUrls = objectUrlsRef.current;
        objectUrlsRef.current = newObjectUrls;
        setPhotos(mergedPhotos);
        lastKnownPhotosRef.current = mergedPhotos;
        setFailedCount(signedUrlFailures);
        requestAnimationFrame(() => {
          setTimeout(() => {
            oldUrls.forEach(url => URL.revokeObjectURL(url));
          }, 0);
        });

      } else {
        const sortedOffline = offlinePhotosList.sort((a, b) => a.display_order - b.display_order);
        if (isPhotoTraceEnabled()) {
          const trace = {
            ts: Date.now(),
            event: 'PhotoGallery.load.offline',
            inspectionId, section,
            offlineRows: sortedOffline.map(p => ({ id: p.id, caption: p.caption, uploaded: p.uploaded, rawStoragePath: (p as any).rawStoragePath })),
          };
          // eslint-disable-next-line no-console
          console.debug('[photo-trace PhotoGallery.load.offline]', trace);
          try { (window as any).__photoTrace = (window as any).__photoTrace || []; (window as any).__photoTrace.push(trace); } catch { /* ignore */ }
        }
        const oldUrls = objectUrlsRef.current;
        objectUrlsRef.current = newObjectUrls;
        setPhotos(sortedOffline);
        lastKnownPhotosRef.current = sortedOffline;
        setFailedCount(0);
        requestAnimationFrame(() => {
          setTimeout(() => {
            oldUrls.forEach(url => URL.revokeObjectURL(url));
          }, 0);
        });
      }

    } catch (error) {
      console.error('[PhotoGallery] Failed to load photos:', error);
      // Do NOT clear photos — keep the last-known list rendered so a transient
      // failure (network blip, IDB hiccup) doesn't visually drop pending uploads.
    } finally {
      setLoading(false);
      initialLoadDone.current = true;
    }
  }, [inspectionId, section, isOnline, tableName, foreignKeyColumn, storageBucket]);

  // Initial load — shows spinner with 15s safety timeout
  useEffect(() => {
    initialLoadDone.current = false;
    loadPhotos();
    
    const safetyTimeout = setTimeout(() => {
      if (!initialLoadDone.current) {
        console.warn('[PhotoGallery] Safety timeout (15s) — forcing loading=false');
        setLoading(false);
        initialLoadDone.current = true;
      }
    }, 15000);
    
    return () => {
      clearTimeout(safetyTimeout);
      objectUrlsRef.current.forEach(url => {
        URL.revokeObjectURL(url);
      });
      objectUrlsRef.current = [];
    };
  }, [inspectionId, section]);

  // Silent refresh on network change — no spinner
  useEffect(() => {
    if (!initialLoadDone.current) return;
    loadPhotos(true);
  }, [isOnline, loadPhotos]);

  // Refresh signed URLs every 45 minutes to prevent expiration (URLs last 1 hour)
  useEffect(() => {
    if (!initialLoadDone.current) return;
    const REFRESH_INTERVAL_MS = 45 * 60 * 1000;
    const interval = setInterval(() => {
      if (import.meta.env.DEV) {
        console.log('[PhotoGallery] Refreshing signed URLs (45-min interval)');
      }
      loadPhotos(true);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadPhotos]);

  // Exit batch mode when photos change and selection becomes stale
  useEffect(() => {
    if (batchMode) {
      const photoIds = new Set(photos.map(p => p.id));
      setSelectedIds(prev => {
        const next = new Set<string>();
        prev.forEach(id => { if (photoIds.has(id)) next.add(id); });
        return next;
      });
    }
  }, [photos, batchMode]);

  // Audit L1: per-photo dedup of background HEIC inspection.
  //
  // Previously the effect re-fetched + magic-byte-probed *every* photo on
  // every length change. With 30 photos, scrolling that adds 5 new ones
  // re-fetches 35 blobs end-to-end (the original 30 + the 5 new) for
  // network photos, even though the original 30 had already been confirmed
  // non-HEIC. The ref below records ids we've already inspected so each
  // photo is fetched + probed at most once per gallery instance.
  const inspectedHeicIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (loading || photos.length === 0) return;

    const abortController = new AbortController();

    const convertInBackground = async () => {
      for (const photo of photos) {
        if (abortController.signal.aborted) return;
        if (!photo.uploaded) continue; // skip pending local uploads
        if (inspectedHeicIdsRef.current.has(photo.id)) continue; // already inspected

        try {
          // Get the blob to check magic bytes
          let blob: Blob | null = null;
          
          if (photo.blob) {
            blob = photo.blob;
          } else if (photo.photoUrl.startsWith('http')) {
            const resp = await fetch(photo.photoUrl);
            if (!resp.ok) continue;
            blob = await resp.blob();
          } else {
            continue;
          }
          
          if (abortController.signal.aborted) return;
          
          const actuallyHeic = await isHeicBlob(blob);
          if (!actuallyHeic) {
            // Non-HEIC: definitely never want to re-fetch this blob.
            inspectedHeicIdsRef.current.add(photo.id);
            continue;
          }

          if (import.meta.env.DEV) {
            console.log(`[PhotoGallery] Background converting HEIC photo: ${photo.id}`);
          }

          const jpegBlob = await convertHeicBlobToJpeg(blob, 0.85);
          // Audit L1 follow-up: only mark as inspected after a successful
          // conversion AND while the effect is still alive. If the effect
          // was torn down mid-decode (length change) we want the next run
          // to retry the conversion, not silently skip the photo and leave
          // it rendering as raw HEIC bytes (broken in Chrome/Firefox).
          if (!jpegBlob || abortController.signal.aborted) continue;

          const objectUrl = URL.createObjectURL(jpegBlob);
          objectUrlsRef.current.push(objectUrl);

          // Progressively update this single photo in state
          setPhotos(prev => prev.map(p => 
            p.id === photo.id ? { ...p, photoUrl: objectUrl, blob: jpegBlob, isHeic: false } : p
          ));
          inspectedHeicIdsRef.current.add(photo.id);
          
          // Fire-and-forget: re-upload + re-cache
          // Find original storage path from the DB photo_url (not the signed URL)
          // The doCaching background task already handles re-upload via reuploadConvertedJpeg
        } catch (e) {
          console.warn(`[PhotoGallery] Background HEIC conversion failed for ${photo.id}:`, e);
        }
      }
    };
    
    // Delay slightly to let the UI settle
    const timer = setTimeout(convertInBackground, 500);
    
    return () => {
      abortController.abort();
      clearTimeout(timer);
    };
  }, [loading, photos.length]); // only re-run when photo count changes, not on every progressive update




  const handleDragStart = (event: DragStartEvent) => {
    console.log('[PhotoGallery] Drag started:', event.active.id);
    setActiveId(event.active.id as string);
    triggerHaptic('selection');
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    console.log('[PhotoGallery] Drag ended:', { active: active.id, over: over?.id });
    
    if (over && active.id !== over.id) {
      setPhotos((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        
        const updatedOrder = newOrder.map((photo, index) => ({
          ...photo,
          display_order: index,
        }));
        
        persistPhotoOrder(updatedOrder);
        
        return updatedOrder;
      });
      triggerHaptic('success');
    } else {
      triggerHaptic('light');
    }
    
    setActiveId(null);
  };

  const handleDragCancel = () => {
    setActiveId(null);
    triggerHaptic('error');
  };

  const persistPhotoOrder = async (orderedPhotos: Photo[]) => {
    try {
      const photoIds = orderedPhotos.map(p => p.id);
      updatePhotoDisplayOrder(inspectionId, section, photoIds).catch(e =>
        console.warn('[PhotoGallery] Non-critical: failed to update IndexedDB order', e)
      );
      
      if (isOnline) {
        const updates = orderedPhotos
          .filter(p => p.uploaded)
          .map((photo, index) => ({
            id: photo.id,
            display_order: index,
          }));
        
        if (updates.length > 0) {
          Promise.all(
            updates.map(update =>
              (supabase
                .from(tableName) as any)
                .update({ display_order: update.display_order })
                .eq('id', update.id)
            )
          ).catch(error => {
            console.error('[PhotoGallery] Failed to batch update order:', error);
          });
        }
      }
    } catch (error) {
      console.error('[PhotoGallery] Failed to persist photo order:', error);
    }
  };

  /** Core delete logic shared by single and batch operations */
  const executeDelete = async (photosToDelete: Photo[]) => {
    if ((await import('@/lib/environment')).isLovablePreview()) {
      toast.info("Preview mode", { description: "Photo deletion is disabled in the Lovable preview." });
      return;
    }
    triggerHaptic('warning');

    try {
      // Partition photos by type
      const uploadedOnline = photosToDelete.filter(p => p.uploaded && isOnline);
      const uploadedOffline = photosToDelete.filter(p => p.uploaded && !isOnline);
      const localOnly = photosToDelete.filter(p => !p.uploaded);

      const now = new Date();
      const retentionDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
      const deletedAt = now.toISOString();
      const retentionUntil = retentionDate.toISOString();

      // Batch soft-delete uploaded+online photos in one query
      if (uploadedOnline.length > 0) {
        const ids = uploadedOnline.map(p => p.id);
        const { error } = await (supabase
          .from(tableName) as any)
          .update({ deleted_at: deletedAt, retention_until: retentionUntil })
          .in('id', ids);
        if (error) throw error;
      }

      // Queue offline operations for uploaded+offline photos
      if (uploadedOffline.length > 0) {
        const { queueOperation } = await import('@/lib/offline-storage');
        await Promise.all(uploadedOffline.map(p =>
          queueOperation('update', p.id, {
            id: p.id,
            deleted_at: deletedAt,
            retention_until: retentionUntil,
          })
        ));
      }

      // Delete local-only photos from IndexedDB
      if (localOnly.length > 0) {
        const { deleteOfflinePhoto } = await import('@/lib/offline-storage');
        await Promise.all(localOnly.map(p => deleteOfflinePhoto(p.id)));
      }

      const count = photosToDelete.length;
      toast.success(`${count} photo${count > 1 ? 's' : ''} deleted`, {
        description: "Recoverable for 60 days.",
      });

      await loadPhotos();
    } catch (error) {
      console.error('[PhotoGallery] Failed to delete photos:', error);
      toast.error("Failed to delete photos");
    }
  };

  const handleDeleteClick = (photo: Photo) => {
    setDeleteConfirm({ type: 'single', photo });
  };

  const handleBatchDeleteClick = () => {
    if (selectedIds.size === 0) return;
    setDeleteConfirm({ type: 'batch' });
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return;

    if (deleteConfirm.type === 'single') {
      await executeDelete([deleteConfirm.photo]);
    } else {
      const photosToDelete = photos.filter(p => selectedIds.has(p.id));
      await executeDelete(photosToDelete);
      setBatchMode(false);
      setSelectedIds(new Set());
    }
    setDeleteConfirm(null);
  };

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = () => setSelectedIds(new Set(photos.map(p => p.id)));
  const deselectAll = () => setSelectedIds(new Set());

  const exitBatchMode = () => {
    setBatchMode(false);
    setSelectedIds(new Set());
  };

  const activePhoto = activeId ? photos.find(p => p.id === activeId) : null;

  // Confirmation dialog content
  const confirmTitle = deleteConfirm?.type === 'batch'
    ? `Delete ${selectedIds.size} photo${selectedIds.size > 1 ? 's' : ''}?`
    : 'Delete photo?';
  const confirmDesc = deleteConfirm?.type === 'batch'
    ? `This will remove ${selectedIds.size} photo${selectedIds.size > 1 ? 's' : ''}. They can be recovered within 60 days.`
    : 'This photo can be recovered within 60 days.';

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (photos.length === 0 && evictedCount === 0) {
    return (
      <div className="text-center p-8 text-muted-foreground">
        No photos yet. Add photos using the button above.
      </div>
    );
  }

  return (
    <>
      {/* Batch mode controls */}
      {!readOnly && photos.length > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {!batchMode ? (
            <Button variant="outline" size="sm" onClick={() => setBatchMode(true)}>
              <CheckSquare className="w-4 h-4 mr-1.5" />
              Select
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={exitBatchMode}>
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={selectedIds.size === photos.length ? deselectAll : selectAll}
              >
                {selectedIds.size === photos.length ? 'Deselect All' : 'Select All'}
              </Button>
              {selectedIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBatchDeleteClick}
                >
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  Delete ({selectedIds.size})
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {/* Vector 5: Warning banner for evicted photo blobs */}
      {evictedCount > 0 && (
        <div className="mb-4 p-3 border-2 border-destructive rounded-lg bg-destructive/10 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
          <p className="text-sm text-destructive font-medium">
            {evictedCount} photo{evictedCount > 1 ? 's were' : ' was'} lost from local storage (browser storage pressure). 
            Please retake {evictedCount > 1 ? 'these photos' : 'this photo'}.
          </p>
        </div>
      )}
      {/* Warning banner for photos that failed to load from cloud */}
      {failedCount > 0 && (
        <div className="mb-4 p-3 border-2 border-orange-500 rounded-lg bg-orange-500/10 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0" />
          <p className="text-sm text-orange-700 dark:text-orange-300 font-medium">
            {failedCount} photo{failedCount > 1 ? 's' : ''} could not be loaded from the server. 
            Try refreshing the page or check your connection.
          </p>
        </div>
      )}
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      autoScroll={{ threshold: { x: 0.1, y: 0.15 }, acceleration: 15 }}
    >
      <SortableContext items={photos.map(p => p.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {photos.map((photo) => (
            <DraggablePhotoItem key={photo.id} id={photo.id} disabled={readOnly || batchMode}>
              <Card
                className={`relative group overflow-hidden flex flex-col border-2 transition-all ${
                  batchMode && selectedIds.has(photo.id)
                    ? 'border-destructive ring-2 ring-destructive'
                    : 'border-black dark:border-white'
                } ${batchMode ? 'cursor-pointer' : ''}`}
                onClick={batchMode ? () => toggleSelection(photo.id) : undefined}
              >
                <div data-lightbox-trigger className="relative" onClick={!batchMode ? (e) => { e.stopPropagation(); setSelectedPhotoIndex(photos.indexOf(photo)); } : undefined} style={!batchMode ? { cursor: 'pointer' } : undefined}>
                  {/* Batch selection checkbox overlay */}
                  {batchMode && (
                    <div className="absolute top-2 left-2 z-10">
                      <Checkbox
                        checked={selectedIds.has(photo.id)}
                        onCheckedChange={() => toggleSelection(photo.id)}
                        className="h-5 w-5 bg-background/90 backdrop-blur-sm"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  )}
                  <OptimizedImage
                    src={photo.photoUrl}
                    alt={photo.caption || "Inspection photo"}
                    className="w-full h-48 object-cover"
                    containerClassName="h-48"
                  />
                  <div className="absolute top-2 right-2 flex gap-2">
                  {!photo.uploaded && photo.staleUpload && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Stuck
                      </Badge>
                    )}
                    {!photo.uploaded && !photo.staleUpload && (
                      <Badge variant="secondary" className="gap-1">
                        <CloudOff className="w-3 h-3" />
                        Pending
                      </Badge>
                    )}
                    {photo.uploaded && (
                      <Badge variant="default" className="gap-1">
                        <Cloud className="w-3 h-3" />
                        Synced
                      </Badge>
                    )}
                  </div>
                  {!readOnly && !batchMode && (
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute bottom-2 right-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                      onClick={() => handleDeleteClick(photo)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                {/* Caption input - available for all photos (online and offline) */}
                <div className="p-2 border-t border-border">
                  <PhotoCaptionInput
                    photoId={photo.id}
                    initialCaption={photo.caption}
                    tableName={tableName}
                    disabled={readOnly}
                    onOfflineSave={!photo.uploaded ? async (newCaption) => {
                      try {
                        const { updateOfflinePhotoCaption } = await import("@/lib/offline-storage");
                        const success = await updateOfflinePhotoCaption(photo.id, newCaption);
                        if (!success) {
                          console.warn('[PhotoGallery] Failed to save caption locally for:', photo.id);
                        }
                      } catch (e) {
                        console.warn('[PhotoGallery] Caption save error:', e);
                      }
                      // Always update local state so UI reflects the change
                      setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, caption: newCaption } : p));
                    } : undefined}
                  />
                </div>
              </Card>
            </DraggablePhotoItem>
          ))}
        </div>
      </SortableContext>
      
      {/* Drag Overlay - Floating preview of dragged photo */}
      <DragOverlay>
        {activePhoto && (
          <div className="shadow-2xl scale-105 rotate-2 rounded-lg overflow-hidden bg-background">
            <OptimizedImage 
              src={activePhoto.photoUrl} 
              alt={activePhoto.caption || "Dragging photo"}
              className="w-48 h-48 object-cover"
              containerClassName="w-48 h-48"
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>

    {/* Delete confirmation dialog */}
    <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{confirmDesc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirmDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Full-size image lightbox with navigation */}
    <Dialog open={selectedPhotoIndex !== null} onOpenChange={(open) => { if (!open) closeLightbox(); }}>
      <DialogContent hideDefaultClose className="lightbox-image max-w-4xl p-2 bg-black/95 border-none [&>button]:hidden">
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
        {selectedPhoto && (
          <div className="relative select-none">
            <img
              src={selectedPhoto.photoUrl}
              alt={selectedPhoto.caption || "Full size photo"}
              className="w-full h-auto max-h-[85vh] object-contain rounded"
            />
            {/* Navigation arrows */}
            {photos.length > 1 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); goToPrev(); }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center transition-colors backdrop-blur-sm"
                  aria-label="Previous photo"
                >
                  <ChevronLeft className="w-7 h-7 text-white" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); goToNext(); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center transition-colors backdrop-blur-sm"
                  aria-label="Next photo"
                >
                  <ChevronRight className="w-7 h-7 text-white" />
                </button>
              </>
            )}
          </div>
        )}
        {/* Caption and counter */}
        <div className="text-center mt-2 space-y-1">
          {selectedPhoto?.caption && (
            <p className="text-white/80 text-sm">{selectedPhoto.caption}</p>
          )}
          {photos.length > 1 && selectedPhotoIndex !== null && (
            <p className="text-white/50 text-xs">{selectedPhotoIndex + 1} / {photos.length}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
