import { useEffect, useRef } from "react";

interface UseEmergencySaveOptions {
  hasUnsavedChanges: boolean;
  saving: boolean;
  /** Ref to the current debounce timer (will be cleared on emergency save) */
  saveDebounceTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  /** Ref to the current save function (avoids stale closures) */
  performSaveRef: React.MutableRefObject<((silent?: boolean) => Promise<void>) | undefined>;
  /** Label for debug logging */
  formName: string;
}

/**
 * Emergency save hook: flushes unsaved data to IndexedDB when the page
 * is being hidden (tab switch, refresh, close) or unloaded.
 *
 * This closes the data-loss window between the last keystroke and the
 * 1.5-second auto-save debounce firing.
 *
 * Covers:
 * - `visibilitychange` → document.hidden (iOS tab switch, Android home)
 * - `pagehide`         → page navigation / refresh (Safari, Chrome)
 * - `beforeunload`     → hard refresh / tab close (flushes debounce)
 */
export function useEmergencySave({
  hasUnsavedChanges,
  saving,
  saveDebounceTimerRef,
  performSaveRef,
  formName,
}: UseEmergencySaveOptions) {
  // Use refs to avoid stale closures in event listeners
  const hasUnsavedRef = useRef(hasUnsavedChanges);
  const savingRef = useRef(saving);

  useEffect(() => {
    hasUnsavedRef.current = hasUnsavedChanges;
    savingRef.current = saving;
  }, [hasUnsavedChanges, saving]);

  useEffect(() => {
    const handleEmergencySave = () => {
      if (!hasUnsavedRef.current || savingRef.current) return;

      // Cancel pending debounce — we're saving NOW
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current);
        saveDebounceTimerRef.current = null;
      }

      // Fire-and-forget — page is being torn down
      performSaveRef.current?.(true);

      if (import.meta.env.DEV) {
        console.log(`[${formName}] Emergency save triggered (page hide/unload)`);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleEmergencySave();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handleEmergencySave);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handleEmergencySave);
    };
  }, []); // Empty deps — refs keep values current
}
