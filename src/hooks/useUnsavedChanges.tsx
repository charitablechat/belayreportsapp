import { useEffect, useCallback } from "react";
import { useNavigate, useBlocker } from "react-router-dom";

interface UseUnsavedChangesOptions {
  hasUnsavedChanges: boolean;
  message?: string;
}

export function useUnsavedChanges({
  hasUnsavedChanges,
  message = "You have unsaved changes. Are you sure you want to leave?",
}: UseUnsavedChangesOptions) {
  const navigate = useNavigate();

  // Block ALL SPA navigation (browser back/forward, link clicks, programmatic navigate)
  const blocker = useBlocker(hasUnsavedChanges);

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

  return {
    isBlocked: blocker.state === "blocked",
    confirmNavigation,
    cancelNavigation,
    safeNavigate,
    message,
  };
}
