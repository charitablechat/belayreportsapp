import { useEffect, useRef } from "react";
import { getOfflineUserId } from "@/lib/cached-auth";
import { recordSaveWithoutIdentity } from "@/lib/offline-readiness";

interface UseEmergencySaveOptions {
  hasUnsavedChanges: boolean;
  saving: boolean;
  /** Ref to the current debounce timer (will be cleared on emergency save) */
  saveDebounceTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  /** Ref to the current save function (avoids stale closures) */
  performSaveRef: React.MutableRefObject<((silent?: boolean) => Promise<void>) | undefined>;
  /** Label for debug logging */
  formName: string;
  /** Optional callback to trigger localStorage snapshot on emergency save */
  onEmergencySnapshot?: () => void;
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
  onEmergencySnapshot,
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
      if (!hasUnsavedRef.current) return;
      // Block all writes in Lovable preview to protect production data
      try { if ((window as any).__lovablePreviewChecked === undefined) { (window as any).__lovablePreviewChecked = window.location.hostname.includes('id-preview--'); } } catch {}
      if ((window as any).__lovablePreviewChecked) return;

      // Always trigger localStorage snapshot FIRST — it's synchronous and
      // survives even if the browser kills the page before IndexedDB finishes.
      // This runs even when a save is already in progress, because that
      // in-flight save may be interrupted before completing all stores.
      try {
        onEmergencySnapshot?.();
      } catch {
        // Never let snapshot failure block emergency save
      }

      // If a save is already running, the localStorage snapshot above is our
      // safety net. Don't start a second concurrent IndexedDB write.
      if (savingRef.current) {
        if (import.meta.env.DEV) {
          console.log(`[${formName}] Emergency snapshot taken (save already in progress)`);
        }
        return;
      }

      // Cancel pending debounce — we're saving NOW
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current);
        saveDebounceTimerRef.current = null;
      }

      // Fire-and-forget — page is being torn down
      try {
        if (!getOfflineUserId()) {
          recordSaveWithoutIdentity({
            op: "emergency-save",
            formName,
            online: typeof navigator !== "undefined" ? navigator.onLine : null,
          });
        }
      } catch {
        // never block emergency save
      }
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
