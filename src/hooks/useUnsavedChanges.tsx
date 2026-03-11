import { useEffect, useCallback } from "react";
import { useNavigate, useBlocker } from "react-router-dom";

interface UseUnsavedChangesOptions {
  hasUnsavedChanges: boolean;
  /** Always block SPA navigation regardless of unsaved state (e.g., always show exit dialog) */
  alwaysBlock?: boolean;
  message?: string;
  onSaveAndLeave?: () => Promise<void>;
}

export function useUnsavedChanges({
  hasUnsavedChanges,
  alwaysBlock = false,
  message = "You have unsaved changes. Are you sure you want to leave?",
  onSaveAndLeave,
}: UseUnsavedChangesOptions) {
  const navigate = useNavigate();

  // Block ALL SPA navigation — always if alwaysBlock, otherwise only when unsaved
  const blocker = useBlocker(alwaysBlock || hasUnsavedChanges);

  // Block hard page unload (refresh, tab close)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges, message]);

  // safeNavigate just calls navigate directly -- useBlocker intercepts if needed
  const safeNavigate = useCallback((to: string | number) => {
    navigate(to as any);
  }, [navigate]);

  const confirmNavigation = useCallback(() => {
    blocker.proceed?.();
  }, [blocker]);

  const cancelNavigation = useCallback(() => {
    blocker.reset?.();
  }, [blocker]);

  const saveAndLeave = useCallback(async () => {
    if (onSaveAndLeave) {
      try {
        await Promise.race([
          onSaveAndLeave(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Save timeout')), 5000)),
        ]);
      } catch (e) {
        console.warn('[useUnsavedChanges] Save before leave failed or timed out:', e);
      }
    }
    blocker.proceed?.();
  }, [blocker, onSaveAndLeave]);

  return {
    isBlocked: blocker.state === "blocked",
    confirmNavigation,
    cancelNavigation,
    saveAndLeave,
    safeNavigate,
    message,
  };
}
