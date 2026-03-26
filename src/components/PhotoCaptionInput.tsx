import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { cn } from "@/lib/utils";

interface PhotoCaptionInputProps {
  photoId: string;
  initialCaption: string | null;
  tableName: "inspection_photos" | "training_photos" | "daily_assessment_photos";
  disabled?: boolean;
  className?: string;
  /** When provided, saves caption locally (IndexedDB) instead of to Supabase */
  onOfflineSave?: (caption: string) => void;
}

/**
 * Caption input for photos with 3-second debounce auto-save
 * Follows the Immediate, Irreversible Persistence pattern
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
    // Offline-only mode: save to IndexedDB via callback
    if (onOfflineSave) {
      onOfflineSave(newCaption);
      lastSavedValueRef.current = newCaption;
      return;
    }

    if (!isOnline) {
      console.log("[PhotoCaptionInput] Offline, caption will sync later");
      return;
    }

    // Optimistic UI - don't wait for DB
    setIsSaving(true);
    
    // Safety timeout - NEVER get stuck in saving state (max 5 seconds)
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
      // Clear safety timeout and reset state
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

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new 3-second debounce timer
    debounceTimerRef.current = setTimeout(() => {
      saveCaption(value);
    }, 3000);
  };

  // Save immediately on blur (if there are pending changes)
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
        disabled={disabled || isSaving}
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
