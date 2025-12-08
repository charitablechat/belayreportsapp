import { useEffect, useCallback, useRef } from "react";
import { useBlocker } from "react-router-dom";

interface UseUnsavedChangesOptions {
  hasUnsavedChanges: boolean;
  message?: string;
}

export function useUnsavedChanges({
  hasUnsavedChanges,
  message = "You have unsaved changes. Are you sure you want to leave?",
}: UseUnsavedChangesOptions) {
  const blockerRef = useRef<ReturnType<typeof useBlocker> | null>(null);

  // Block in-app navigation using React Router's useBlocker
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedChanges && currentLocation.pathname !== nextLocation.pathname
  );

  blockerRef.current = blocker;

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

  const confirmNavigation = useCallback(() => {
    if (blocker.state === "blocked") {
      blocker.proceed();
    }
  }, [blocker]);

  const cancelNavigation = useCallback(() => {
    if (blocker.state === "blocked") {
      blocker.reset();
    }
  }, [blocker]);

  return {
    isBlocked: blocker.state === "blocked",
    confirmNavigation,
    cancelNavigation,
    message,
  };
}
