import { useEffect, useCallback, useRef } from "react";
import { useNavigate, useBlocker } from "react-router-dom";
import { isOverlayActive } from "@/lib/navigation";

interface UseUnsavedChangesOptions {
  hasUnsavedChanges: boolean;
  /** Always block SPA navigation regardless of unsaved state (e.g., always show exit dialog) */
  alwaysBlock?: boolean;
  /** Where to navigate on confirm/save-and-leave (default: '/dashboard') */
  fallbackPath?: string;
  message?: string;
  onSaveAndLeave?: () => Promise<void>;
}

export function useUnsavedChanges({
  hasUnsavedChanges,
  alwaysBlock = false,
  fallbackPath = "/dashboard",
  message = "You have unsaved changes. Are you sure you want to leave?",
  onSaveAndLeave,
}: UseUnsavedChangesOptions) {
  const navigate = useNavigate();

  // Ref-based bypass: set to true right before calling blocker.proceed()
  // This avoids the flushSync race — the ref is read synchronously by the
  // blocker predicate and is never subject to React's batched state updates.
  const bypassRef = useRef(false);

  // Block ALL SPA navigation — always if alwaysBlock, otherwise only when unsaved.
  // The bypassRef lets callers disable the guard synchronously before proceed().
  const blocker = useBlocker(() => {
    if (bypassRef.current) return false;
    // Overlay-aware: synthetic popstate from closing a lightbox/photo overlay
    // must not surface SaveBeforeLeaveDialog. Overlay owners hold the flag
    // true across the synthetic history.back() until their popstate handler
    // finishes cleanup, so this short-circuit is race-safe.
    if (isOverlayActive()) return false;
    return alwaysBlock || hasUnsavedChanges;
  });

  // Block hard page unload (refresh, tab close).
  // Respects alwaysBlock so the native prompt fires even after auto-save.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (alwaysBlock || hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [alwaysBlock, hasUnsavedChanges]);

  // safeNavigate just calls navigate directly -- useBlocker intercepts if needed
  const safeNavigate = useCallback((to: string | number) => {
    navigate(to as any);
  }, [navigate]);

  /** Bypass the blocker and proceed with navigation (no dialog). */
  const bypassAndProceed = useCallback(() => {
    bypassRef.current = true;
    blocker.proceed?.();
  }, [blocker]);

  const confirmNavigation = useCallback(() => {
    bypassRef.current = true;
    blocker.reset?.();
    navigate(fallbackPath);
  }, [blocker, navigate, fallbackPath]);

  const cancelNavigation = useCallback(() => {
    blocker.reset?.();
  }, [blocker]);

  const saveAndLeave = useCallback(async (): Promise<{ ok: boolean; error?: unknown }> => {
    if (onSaveAndLeave) {
      try {
        // Sprint 1 / C1.1: no inner timeout race here. The wrapped
        // `performSave` already owns a 30s deadlock-recovery timer
        // (InspectionForm.tsx, TrainingForm.tsx, DailyAssessmentForm.tsx) and
        // the dialog renders an "Saving…" state for UI feedback. A 5s ceiling
        // here was shorter than a single Supabase round-trip on flaky cell
        // and aborted otherwise-successful saves with a misleading "Save
        // timeout" surface.
        await onSaveAndLeave();
      } catch (e) {
        // Gap 2.1: do NOT navigate away on save failure — that would silently
        // discard the user's data. Surface the failure to the dialog so it can
        // keep the user on the page with the persistent error visible.
        console.warn('[useUnsavedChanges] Save before leave failed:', e);
        return { ok: false, error: e };
      }
    }
    bypassRef.current = true;
    blocker.reset?.();
    navigate(fallbackPath);
    return { ok: true };
  }, [blocker, onSaveAndLeave, navigate, fallbackPath]);

  // Reset bypass when blocker resets (user cancelled or new navigation)
  useEffect(() => {
    if (blocker.state !== "blocked") {
      bypassRef.current = false;
    }
  }, [blocker.state]);

  return {
    isBlocked: blocker.state === "blocked",
    confirmNavigation,
    cancelNavigation,
    saveAndLeave,
    safeNavigate,
    bypassAndProceed,
    message,
  };
}
