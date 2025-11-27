import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Upload, CloudOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { savePhotoOffline } from "@/lib/offline-storage";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { triggerHaptic } from "@/lib/haptics";

interface PhotoCaptureProps {
  inspectionId: string;
  section: string;
  onPhotoAdded: () => void;
}

export default function PhotoCapture({ inspectionId, section, onPhotoAdded }: PhotoCaptureProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { isOnline } = useNetworkStatus();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    triggerHaptic('light');
    setUploading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      for (const file of Array.from(files)) {
        if (isOnline) {
          // Online: Upload directly to Supabase
          const fileExt = file.name.split('.').pop();
          const fileName = `${user.id}/${inspectionId}/${Date.now()}.${fileExt}`;
          
          const { error: uploadError } = await supabase.storage
            .from('inspection-photos')
            .upload(fileName, file);

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
            blob: file,
            fileName: file.name,
            uploaded: false,
          });
          
          if (import.meta.env.DEV) {
            console.log('[PhotoCapture] Saved photo offline:', photoId);
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
