import { useState, useRef, useCallback, useEffect, memo } from "react";
import { Camera, X, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/image-compression";
import { toast } from "@/components/ui/sonner";
import { getUserWithCache } from "@/lib/cached-auth";

interface ItemPhotoUploadProps {
  itemId: string;
  inspectionId: string;
  photoUrl: string | null;
  onPhotoChange: (url: string | null) => void;
  onImmediateSave?: () => void;
  disabled?: boolean;
}

function ItemPhotoUpload({
  itemId,
  inspectionId,
  photoUrl,
  onPhotoChange,
  onImmediateSave,
  disabled = false,
}: ItemPhotoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayUrl = localPreview || signedUrl;

  const loadSignedUrl = useCallback(async () => {
    if (!photoUrl) { setSignedUrl(null); return; }
    try {
      const { data } = await supabase.storage
        .from("inspection-photos")
        .createSignedUrl(photoUrl, 3600);
      if (data?.signedUrl) setSignedUrl(data.signedUrl);
    } catch {
      // silent fail
    }
  }, [photoUrl]);

  useEffect(() => { loadSignedUrl(); }, [loadSignedUrl]);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const compressed = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.8 });
      const previewUrl = URL.createObjectURL(compressed);
      setLocalPreview(previewUrl);

      let userId: string | undefined;
      try {
        const { data: userData } = await getUserWithCache();
        userId = userData?.user?.id;
      } catch {
        // cache miss – fall back to live session
      }
      if (!userId) {
        const { data: sessionData } = await supabase.auth.getSession();
        userId = sessionData?.session?.user?.id;
      }
      if (!userId) throw new Error("Not authenticated");

      const filePath = `${userId}/${inspectionId}/items/${itemId}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("inspection-photos")
        .upload(filePath, compressed, { contentType: "image/jpeg", upsert: true });

      if (uploadError) throw uploadError;

      onPhotoChange(filePath);
      onImmediateSave?.();

      const { data: signedData } = await supabase.storage
        .from("inspection-photos")
        .createSignedUrl(filePath, 3600);
      if (signedData?.signedUrl) {
        setSignedUrl(signedData.signedUrl);
        URL.revokeObjectURL(previewUrl);
        setLocalPreview(null);
      }
    } catch (err: any) {
      console.error("[ItemPhotoUpload] Upload failed:", err);
      const statusCode = err?.statusCode || err?.status;
      const message = statusCode === 403 || statusCode === '403'
        ? "Permission denied – please try logging out and back in"
        : err?.message || "Failed to upload photo";
      toast.error(message);
      setLocalPreview(null);
    } finally {
      setUploading(false);
    }
  }, [itemId, inspectionId, onPhotoChange, onImmediateSave]);

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
    }
    setLocalPreview(null);
    setSignedUrl(null);
    onPhotoChange(null);
    onImmediateSave?.();
    setLightboxOpen(false);
  }, [photoUrl, onPhotoChange, onImmediateSave]);

  const hasPhoto = !!(photoUrl || localPreview);

  return (
    <>
      {/* Camera capture input */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled}
      />
      {/* File browse input (no capture) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled}
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
        </button>
      ) : (
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => cameraInputRef.current?.click()}
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
            {displayUrl && (
              <img src={displayUrl} alt="Item photo full size" className="max-w-full max-h-[60vh] object-contain rounded-lg" />
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => cameraInputRef.current?.click()} disabled={disabled || uploading}>
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
