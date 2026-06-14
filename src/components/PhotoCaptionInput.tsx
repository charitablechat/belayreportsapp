import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { updateOfflinePhotoCaption } from "@/lib/offline-storage";
import { cn } from "@/lib/utils";

interface PhotoCaptionInputProps {
  photoId: string;
  initialCaption: string | null;
  tableName: "inspection_photos" | "training_photos" | "daily_assessment_photos" | "jcf_photos";
  disabled?: boolean;
  className?: string;
  /** When provided, saves caption locally (IndexedDB) instead of to Supabase */
  onOfflineSave?: (caption: string) => void | Promise<void>;
}

/**
 * Caption input for photos with 3-second debounce auto-save
 * Never disables during save to prevent offline input freezes.
 */
export default function PhotoCaptionInput({
  photoId,
  initialCaption,
  tableName,
  disabled = false,
  className,
  onOfflineSave,
}: PhotoCaptionInputProps) {
  const [caption, setCaption] = useState(initialCaption || "");
  const [isSaving, setIsSaving] = useState(false);
  const { isOnline } = useNetworkStatus();
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedValueRef = useRef(initialCaption || "");

  // Update caption when initialCaption changes (e.g., on photo reload)
  useEffect(() => {
    if (initialCaption !== undefined && initialCaption !== caption) {
      setCaption(initialCaption || "");
    }
  }, [initialCaption]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const saveCaption = useCallback(async (newCaption: string) => {
    // Path 1: Explicit offline callback (unsynced photos)
    if (onOfflineSave) {
      try {
        await onOfflineSave(newCaption);
      } catch (err) {
        console.error("[PhotoCaptionInput] onOfflineSave error:", err);
      }
      lastSavedValueRef.current = newCaption;
      return;
    }

    // Path 2: Synced photo but user is offline — queue in IndexedDB
    if (!isOnline) {
      console.log("[PhotoCaptionInput] Offline — queuing caption in IndexedDB");
      try {
        await updateOfflinePhotoCaption(photoId, newCaption);
      } catch (err) {
        console.error("[PhotoCaptionInput] Failed to queue offline caption:", err);
      }
      lastSavedValueRef.current = newCaption;
      return;
    }

    // Path 3: Online — persist to Supabase
    setIsSaving(true);

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      console.warn("[PhotoCaptionInput] Save timeout reached, resetting state");
      setIsSaving(false);
    }, 5000);

    try {
      const { error } = await supabase
        .from(tableName)
        .update({ caption: newCaption })
        .eq("id", photoId);

      if (!error) {
        lastSavedValueRef.current = newCaption;
      } else {
        console.error("[PhotoCaptionInput] Error saving caption:", error);
      }
    } catch (err) {
      console.error("[PhotoCaptionInput] Error saving caption:", err);
    } finally {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      setIsSaving(false);
    }
  }, [isOnline, photoId, tableName, onOfflineSave]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCaption(value);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      saveCaption(value);
    }, 3000);
  };

  const handleBlur = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (caption !== lastSavedValueRef.current) {
      saveCaption(caption);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        type="text"
        value={caption}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="Add caption..."
        disabled={disabled}
        className={cn(
          "text-xs h-8 bg-background/80 backdrop-blur-sm",
          "border-muted-foreground/20 focus:border-primary",
          "placeholder:text-muted-foreground/60",
          isSaving && "opacity-70"
        )}
        aria-label="Photo caption"
      />
      {isSaving && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
