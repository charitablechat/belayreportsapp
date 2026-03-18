import { useEffect, useState, useRef, useCallback } from "react";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { supabase } from "@/integrations/supabase/client";
import { getOfflinePhotos, updatePhotoDisplayOrder } from "@/lib/offline-storage";
import { cachePhotoFromRemote, batchValidateCachedPhotos } from "@/lib/photo-cache";
import { getPhotoReceipts } from "@/lib/photo-receipts";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { isHeicPath, isHeicBlob, convertHeicBlobToJpeg, batchConvertHeicBlobs } from "@/lib/heic-converter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Cloud, CloudOff, Loader2, AlertTriangle, CheckSquare, Trash2 } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";
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

  // Batch selection state
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Confirmation dialog state
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'single'; photo: Photo } | { type: 'batch' } | null>(null);

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
   * Fire-and-forget: re-upload a converted JPEG blob to storage,
   * replacing the mislabeled .jpg that still contains HEIC bytes.
   * This ensures the HTML report generator gets valid JPEG data.
   */
  const reuploadConvertedJpeg = (filePath: string, jpegBlob: Blob) => {
    supabase.storage
      .from(storageBucket)
      .upload(filePath, jpegBlob, { contentType: 'image/jpeg', upsert: true })
      .then(({ error }) => {
        if (error) {
          console.warn('[PhotoGallery] Re-upload converted JPEG failed:', filePath, error.message);
        } else if (import.meta.env.DEV) {
          console.log('[PhotoGallery] Re-uploaded converted JPEG:', filePath);
        }
      })
      .catch(e => console.warn('[PhotoGallery] Re-upload error:', e));
  };

  const initialLoadDone = useRef(false);

  // Initial load — shows spinner
  useEffect(() => {
    initialLoadDone.current = false;
    loadPhotos();
    
    return () => {
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
  }, [isOnline]);

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

  const loadPhotos = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      let signedUrlFailures = 0;
      const newObjectUrls: string[] = [];
      
      const offlinePhotos = await getOfflinePhotos(inspectionId);
      const STALE_THRESHOLD_MS = 10 * 60 * 1000;
      const now = Date.now();
      const offlinePhotosList: Photo[] = offlinePhotos
        .filter(p => p.section === section)
        .map((p, index) => {
          const objectUrl = URL.createObjectURL(p.blob);
          newObjectUrls.push(objectUrl);
          const createdAt = (p as any).createdAt || (p as any).created_at;
          const isStale = !p.uploaded && createdAt && (now - new Date(createdAt).getTime() > STALE_THRESHOLD_MS);
          return {
            id: p.id,
            photoUrl: objectUrl,
            blob: p.blob,
            uploaded: p.uploaded,
            caption: null,
            display_order: p.display_order ?? index,
            staleUpload: isStale,
          };
        });

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
                  // Mark for HEIC check — magic byte detection happens in the conversion step
                  isHeic: true, // check all uncached photos by magic bytes
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
                  .then(async (blob) => {
                    // Detect HEIC by magic bytes (catches mislabeled .jpg files too)
                    const heicDetected = isHeicPath(photo.photo_url) || await isHeicBlob(blob);
                    if (heicDetected) {
                      const jpegBlob = await convertHeicBlobToJpeg(blob, 0.85);
                      if (jpegBlob) {
                        // Re-upload the real JPEG to storage so reports work
                        reuploadConvertedJpeg(photo.photo_url, jpegBlob);
                        return cachePhotoFromRemote(photo.id, jpegBlob, photo.photo_url, inspectionId, section);
                      }
                    }
                    return cachePhotoFromRemote(photo.id, blob, photo.photo_url, inspectionId, section);
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

        // Convert uncached photos that contain HEIC bytes (3 at a time)
        // We marked ALL uncached photos with isHeic=true for magic byte checking
        const heicUncached = batchPhotos
          .map((p, idx) => ({ photo: p, idx, originalPath: uncachedPhotos[idx]?.photo?.photo_url }))
          .filter(item => item.photo.isHeic);
        
        if (heicUncached.length > 0) {
          for (let i = 0; i < heicUncached.length; i += 3) {
            const chunk = heicUncached.slice(i, i + 3);
            await Promise.allSettled(
              chunk.map(async ({ photo, originalPath }) => {
                try {
                  const response = await fetch(photo.photoUrl);
                  if (!response.ok) return;
                  const blob = await response.blob();
                  // Check magic bytes — only convert if actually HEIC
                  const actuallyHeic = await isHeicBlob(blob);
                  if (actuallyHeic) {
                    const jpegBlob = await convertHeicBlobToJpeg(blob, 0.8);
                    if (jpegBlob) {
                      const objectUrl = URL.createObjectURL(jpegBlob);
                      newObjectUrls.push(objectUrl);
                      photo.photoUrl = objectUrl;
                      photo.isHeic = false;
                      // Re-upload the real JPEG to storage so reports work
                      if (originalPath) reuploadConvertedJpeg(originalPath, jpegBlob);
                    }
                  } else {
                    // Not actually HEIC — mark as fine
                    photo.isHeic = false;
                  }
                } catch (e) {
                  console.warn(`[PhotoGallery] HEIC check/conversion failed for ${photo.id}:`, e);
                }
              })
            );
          }
        }

        const supabasePhotos: Photo[] = [...cachedPhotos, ...batchPhotos];

        const pendingPhotos = offlinePhotosList.filter(p => !p.uploaded);
        const mergedPhotos = [...pendingPhotos, ...supabasePhotos].sort(
          (a, b) => a.display_order - b.display_order
        );
        const oldUrls = objectUrlsRef.current;
        objectUrlsRef.current = newObjectUrls;
        setPhotos(mergedPhotos);
        setFailedCount(signedUrlFailures);
        requestAnimationFrame(() => {
          setTimeout(() => {
            oldUrls.forEach(url => URL.revokeObjectURL(url));
          }, 0);
        });
      } else {
        const sortedOffline = offlinePhotosList.sort((a, b) => a.display_order - b.display_order);
        const oldUrls = objectUrlsRef.current;
        objectUrlsRef.current = newObjectUrls;
        setPhotos(sortedOffline);
        setFailedCount(0);
        requestAnimationFrame(() => {
          setTimeout(() => {
            oldUrls.forEach(url => URL.revokeObjectURL(url));
          }, 0);
        });
      }
    } catch (error) {
      console.error('[PhotoGallery] Failed to load photos:', error);
    } finally {
      setLoading(false);
      initialLoadDone.current = true;
    }
  };

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
                <div className="relative">
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
                {/* Caption input - only show for uploaded photos */}
                {photo.uploaded && (
                  <div className="p-2 border-t border-border">
                    <PhotoCaptionInput
                      photoId={photo.id}
                      initialCaption={photo.caption}
                      tableName={tableName}
                      disabled={readOnly}
                    />
                  </div>
                )}
                {/* Show placeholder for offline photos */}
                {!photo.uploaded && (
                  <div className="p-2 border-t border-border">
                    <p className="text-xs text-muted-foreground italic">
                      Caption available after sync
                    </p>
                  </div>
                )}
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
    </>
  );
}
