import { useEffect, useState, useRef } from "react";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { supabase } from "@/integrations/supabase/client";
import { getOfflinePhotos, updatePhotoDisplayOrder } from "@/lib/offline-storage";
import { cachePhotoFromRemote, batchValidateCachedPhotos } from "@/lib/photo-cache";
import { getPhotoReceipts } from "@/lib/photo-receipts";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Cloud, CloudOff, Loader2, AlertTriangle } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";
import PhotoCaptionInput from "./PhotoCaptionInput";
import { DraggablePhotoItem } from "./DraggablePhotoItem";
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

  // Desktop-first sensor configuration with mobile support
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,  // Reduced from 8 for more responsive desktop dragging
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,   // Reduced from 200ms for quicker mobile activation
        tolerance: 8, // Increased for better touch detection
      },
    }),
    useSensor(KeyboardSensor)
  );

  const initialLoadDone = useRef(false);

  // Initial load — shows spinner
  useEffect(() => {
    initialLoadDone.current = false;
    loadPhotos();
    
    // Cleanup: revoke all object URLs on unmount
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

  const loadPhotos = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      
      // Collect new object URLs separately — don't revoke old ones yet
      const newObjectUrls: string[] = [];
      
      // Load from IndexedDB first (includes offline photos)
      const offlinePhotos = await getOfflinePhotos(inspectionId);
      const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
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

      // Vector 5: Cross-reference photo receipts against IndexedDB to detect evicted blobs
      const receipts = getPhotoReceipts(inspectionId, section);
      const offlinePhotoIds = new Set(offlinePhotos.filter(p => p.section === section).map(p => p.id));
      const evictedPhotos = receipts.filter(r => !r.uploaded && !offlinePhotoIds.has(r.id));
      setEvictedCount(evictedPhotos.length);

      // If online, also load from Supabase
      if (isOnline) {
      const { data, error } = await (supabase
          .from(tableName) as any)
          .select('*')
          .eq(foreignKeyColumn, inspectionId)
          .eq('photo_section', section)
          .is('deleted_at', null)
          .order('display_order', { ascending: true });

        if (error) throw error;

        // Build a set of valid cached photo IDs in one batch IndexedDB read
        const supabasePhotoIds = (data || []).map((p: any) => p.id);
        const validCacheIds = await batchValidateCachedPhotos(supabasePhotoIds);

        const supabasePhotos: Photo[] = await Promise.all(
          (data || []).map(async (photo: any, index: number) => {
            // Check if we have a valid cached blob — use it instantly
            const existingOfflinePhoto = offlinePhotos.find(
              p => p.photoUrl === photo.photo_url
            );

            if (existingOfflinePhoto?.blob && validCacheIds.has(photo.id)) {
              // INSTANT: Display from local IndexedDB blob — zero network latency
              const objectUrl = URL.createObjectURL(existingOfflinePhoto.blob);
              newObjectUrls.push(objectUrl);
              return {
                id: photo.id,
                photoUrl: objectUrl,
                uploaded: true,
                caption: photo.caption,
                display_order: photo.display_order ?? index,
              };
            }

            // Not cached or expired — get signed URL for display
            const { data: signedUrlData, error: urlError } = await supabase.storage
              .from(storageBucket)
              .createSignedUrl(photo.photo_url, 3600);

            if (urlError) {
              console.error('[PhotoGallery] Error creating signed URL:', urlError);
              return null;
            }

            // Queue background caching (non-blocking, fire-and-forget)
            const signedUrl = signedUrlData.signedUrl;
            const photoId = photo.id;
            const storagePath = photo.photo_url;
            const inspId = inspectionId;
            const sec = section;
            if (typeof requestIdleCallback === 'function') {
              requestIdleCallback(() => {
                fetch(signedUrl)
                  .then(r => { if (r.ok) return r.blob(); throw new Error('fetch failed'); })
                  .then(blob => cachePhotoFromRemote(photoId, blob, storagePath, inspId, sec))
                  .catch(e => console.warn('[PhotoGallery] Background cache failed:', e));
              });
            } else {
              setTimeout(() => {
                fetch(signedUrl)
                  .then(r => { if (r.ok) return r.blob(); throw new Error('fetch failed'); })
                  .then(blob => cachePhotoFromRemote(photoId, blob, storagePath, inspId, sec))
                  .catch(e => console.warn('[PhotoGallery] Background cache failed:', e));
              }, 100);
            }

            return {
              id: photo.id,
              photoUrl: signedUrl,
              uploaded: true,
              caption: photo.caption,
              display_order: photo.display_order ?? index,
            };
          })
        ).then(photos => photos.filter(photo => photo !== null) as Photo[]);

        // Merge offline (pending upload) and online photos, sorted by display_order
        const pendingPhotos = offlinePhotosList.filter(p => !p.uploaded);
        const mergedPhotos = [...pendingPhotos, ...supabasePhotos].sort(
          (a, b) => a.display_order - b.display_order
        );
        // Swap URLs atomically: set new state first, then revoke old URLs
        const oldUrls = objectUrlsRef.current;
        objectUrlsRef.current = newObjectUrls;
        setPhotos(mergedPhotos);
        // Deferred revocation: wait for React commit + browser paint
        requestAnimationFrame(() => {
          setTimeout(() => {
            oldUrls.forEach(url => URL.revokeObjectURL(url));
          }, 0);
        });
      } else {
        // Offline: show only cached photos sorted by display_order
        const sortedOffline = offlinePhotosList.sort((a, b) => a.display_order - b.display_order);
        const oldUrls = objectUrlsRef.current;
        objectUrlsRef.current = newObjectUrls;
        setPhotos(sortedOffline);
        // Deferred revocation: wait for React commit + browser paint
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
        
        // Update display_order for all items
        const updatedOrder = newOrder.map((photo, index) => ({
          ...photo,
          display_order: index,
        }));
        
        // Persist to database and IndexedDB
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
      // Save to IndexedDB for offline support (non-blocking)
      const photoIds = orderedPhotos.map(p => p.id);
      updatePhotoDisplayOrder(inspectionId, section, photoIds).catch(e =>
        console.warn('[PhotoGallery] Non-critical: failed to update IndexedDB order', e)
      );
      
      // If online, sync to database with parallel updates (fire-and-forget for speed)
      if (isOnline) {
        const updates = orderedPhotos
          .filter(p => p.uploaded)
          .map((photo, index) => ({
            id: photo.id,
            display_order: index,
          }));
        
        if (updates.length > 0) {
          // Execute all updates in parallel (not sequential) for max speed
          // This is ~N times faster than sequential awaits
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

  const handleDelete = async (photo: Photo) => {
    triggerHaptic('warning');
    try {
      if (isOnline && photo.uploaded) {
        // Soft-delete with 60-day retention (recoverable)
        const { error } = await (supabase
          .from(tableName) as any)
          .update({ 
            deleted_at: new Date().toISOString(),
            retention_until: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
          })
          .eq('id', photo.id);

        if (error) throw error;
      }

      // Always refresh to show updated list
      await loadPhotos();
    } catch (error) {
      console.error('[PhotoGallery] Failed to delete photo:', error);
    }
  };

  const activePhoto = activeId ? photos.find(p => p.id === activeId) : null;

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
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={photos.map(p => p.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {photos.map((photo) => (
            <DraggablePhotoItem key={photo.id} id={photo.id} disabled={readOnly}>
              <Card className="relative group overflow-hidden flex flex-col border-2 border-black dark:border-white">
                <div className="relative">
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
                  {!readOnly && (
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute bottom-2 right-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                      onClick={() => handleDelete(photo)}
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
    </>
  );
}
