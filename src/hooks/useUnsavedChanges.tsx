import { useEffect, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";

interface UseUnsavedChangesOptions {
  hasUnsavedChanges: boolean;
  message?: string;
}

export function useUnsavedChanges({
  hasUnsavedChanges,
  message = "You have unsaved changes. Are you sure you want to leave?",
}: UseUnsavedChangesOptions) {
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Handle browser back/forward, refresh, and close
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

  // Intercept navigation attempts
  const safeNavigate = useCallback((to: string) => {
    if (hasUnsavedChanges) {
      setPendingNavigation(to);
    } else {
      navigate(to);
    }
  }, [hasUnsavedChanges, navigate]);

  const confirmNavigation = useCallback(() => {
    if (pendingNavigation) {
      const destination = pendingNavigation;
      setPendingNavigation(null);
      navigate(destination);
    }
  }, [pendingNavigation, navigate]);

  const cancelNavigation = useCallback(() => {
    setPendingNavigation(null);
  }, []);

  return {
    isBlocked: pendingNavigation !== null,
    confirmNavigation,
    cancelNavigation,
    safeNavigate,
    message,
  };
}
