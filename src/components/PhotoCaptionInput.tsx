import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { cn } from "@/lib/utils";

interface PhotoCaptionInputProps {
  photoId: string;
  initialCaption: string | null;
  tableName: "inspection_photos" | "training_photos";
  disabled?: boolean;
  className?: string;
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
}: PhotoCaptionInputProps) {
  const [caption, setCaption] = useState(initialCaption || "");
  const [isSaving, setIsSaving] = useState(false);
  const { isOnline } = useNetworkStatus();
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedValueRef = useRef(initialCaption || "");

  // Sync with initial caption if it changes externally
  useEffect(() => {
    if (initialCaption !== null && initialCaption !== lastSavedValueRef.current) {
      setCaption(initialCaption);
      lastSavedValueRef.current = initialCaption;
    }
  }, [initialCaption]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const saveCaption = useCallback(async (value: string) => {
    // Only save if online and value has changed
    if (!isOnline) {
      if (import.meta.env.DEV) {
        console.log('[PhotoCaptionInput] Offline - caption will be saved when online');
      }
      return;
    }

    if (value === lastSavedValueRef.current) {
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from(tableName)
        .update({ caption: value || null })
        .eq("id", photoId);

      if (error) {
        console.error("[PhotoCaptionInput] Failed to save caption:", error);
      } else {
        lastSavedValueRef.current = value;
        if (import.meta.env.DEV) {
          console.log("[PhotoCaptionInput] Caption saved:", value);
        }
      }
    } catch (err) {
      console.error("[PhotoCaptionInput] Error saving caption:", err);
    } finally {
      setIsSaving(false);
    }
  }, [isOnline, photoId, tableName]);

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
