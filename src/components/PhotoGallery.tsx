import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOfflinePhotos, savePhotoOffline } from "@/lib/offline-storage";
import { cachePhotoFromRemote, validateCachedPhoto } from "@/lib/photo-cache";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Cloud, CloudOff, Loader2 } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";

interface PhotoGalleryProps {
  inspectionId: string;
  section: string;
}

interface Photo {
  id: string;
  photoUrl: string;
  blob?: Blob;
  uploaded: boolean;
}

export default function PhotoGallery({ inspectionId, section }: PhotoGalleryProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const { isOnline } = useNetworkStatus();
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    loadPhotos();
    
    // Cleanup: revoke all object URLs on unmount
    return () => {
      objectUrlsRef.current.forEach(url => {
        URL.revokeObjectURL(url);
      });
      objectUrlsRef.current = [];
    };
  }, [inspectionId, section, isOnline]);

  const loadPhotos = async () => {
    try {
      setLoading(true);
      
      // Load from IndexedDB first (includes offline photos)
      const offlinePhotos = await getOfflinePhotos(inspectionId);
      const offlinePhotosList: Photo[] = offlinePhotos
        .filter(p => p.section === section)
        .map(p => {
          const objectUrl = URL.createObjectURL(p.blob);
          objectUrlsRef.current.push(objectUrl);
          return {
            id: p.id,
            photoUrl: objectUrl,
            blob: p.blob,
            uploaded: p.uploaded,
          };
        });

      // If online, also load from Supabase
      if (isOnline) {
        const { data, error } = await supabase
          .from('inspection_photos')
          .select('*')
          .eq('inspection_id', inspectionId)
          .eq('photo_section', section);

        if (error) throw error;

        const supabasePhotos: Photo[] = await Promise.all(
          (data || []).map(async (photo) => {
            // Get public URL
            const { data: { publicUrl } } = supabase.storage
              .from('inspection-photos')
              .getPublicUrl(photo.photo_url);

            // Check if photo is already cached and still valid
            const existingOfflinePhoto = offlinePhotos.find(
              p => p.photoUrl === photo.photo_url
            );
            
            if (existingOfflinePhoto) {
              const isValid = await validateCachedPhoto(photo.id);
              
              if (isValid) {
                // Use cached photo
                return {
                  id: photo.id,
                  photoUrl: publicUrl,
                  uploaded: true,
                };
              }
            }

            // Cache photo blob for offline viewing (if not cached or expired)
            try {
              const response = await fetch(publicUrl);
              const blob = await response.blob();
              
              // Save/update cache with timestamp
              await cachePhotoFromRemote(
                photo.id,
                blob,
                photo.photo_url,
                inspectionId,
                section
              );
            } catch (cacheError) {
              console.error('[PhotoGallery] Failed to cache photo:', cacheError);
            }

            return {
              id: photo.id,
              photoUrl: publicUrl,
              uploaded: true,
            };
          })
        );

        // Merge offline (pending upload) and online photos
        const pendingPhotos = offlinePhotosList.filter(p => !p.uploaded);
        setPhotos([...pendingPhotos, ...supabasePhotos]);
      } else {
        // Offline: show only cached photos
        setPhotos(offlinePhotosList);
      }
    } catch (error) {
      console.error('[PhotoGallery] Failed to load photos:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (photo: Photo) => {
    triggerHaptic('warning');
    try {
      if (isOnline && photo.uploaded) {
        // Delete from Supabase
        const { error } = await supabase
          .from('inspection_photos')
          .delete()
          .eq('id', photo.id);

        if (error) throw error;
      }

      // Always refresh to show updated list
      await loadPhotos();
    } catch (error) {
      console.error('[PhotoGallery] Failed to delete photo:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="text-center p-8 text-muted-foreground">
        No photos yet. Add photos using the button above.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {photos.map((photo) => (
        <Card key={photo.id} className="relative group overflow-hidden">
          <img
            src={photo.photoUrl}
            alt="Inspection photo"
            className="w-full h-48 object-cover"
          />
          <div className="absolute top-2 right-2 flex gap-2">
            {!photo.uploaded && (
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
          <Button
            variant="destructive"
            size="icon"
            className="absolute bottom-2 right-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
            onClick={() => handleDelete(photo)}
          >
            <X className="w-4 h-4" />
          </Button>
        </Card>
      ))}
    </div>
  );
}
