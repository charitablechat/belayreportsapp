import { useEffect, useRef, useState, useCallback } from "react";

interface UseActiveTimerOptions {
  initialSeconds?: number;
  enabled?: boolean;
}

export function useActiveTimer({ initialSeconds = 0, enabled = true }: UseActiveTimerOptions = {}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(initialSeconds);
  const [isActive, setIsActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedRef = useRef(initialSeconds);
  const isActiveRef = useRef(false);
  const isPausedRef = useRef(false);
  const enabledRef = useRef(enabled);

  // Keep refs in sync
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { elapsedRef.current = elapsedSeconds; }, [elapsedSeconds]);

  // Sync initial seconds when they change (e.g. data loaded from DB)
  useEffect(() => {
    elapsedRef.current = initialSeconds;
    setElapsedSeconds(initialSeconds);
  }, [initialSeconds]);

  const startTracking = useCallback(() => {
    if (!enabledRef.current) return;
    isActiveRef.current = true;
    isPausedRef.current = false;
    setIsActive(true);
    setIsPaused(false);
  }, []);

  const pauseTracking = useCallback(() => {
    isPausedRef.current = true;
    setIsPaused(true);
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (!enabledRef.current) return;

    // If we were paused, resume
    if (isPausedRef.current) {
      isPausedRef.current = false;
      setIsPaused(false);
    }

    // If not yet active, start
    if (!isActiveRef.current) {
      startTracking();
    }

    // Reset idle timeout
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      pauseTracking();
    }, 30_000); // 30 second idle threshold
  }, [startTracking, pauseTracking]);

  // 1-second tick interval
  useEffect(() => {
    if (!enabled) return;

    intervalRef.current = setInterval(() => {
      if (isActiveRef.current && !isPausedRef.current) {
        elapsedRef.current += 1;
        setElapsedSeconds(elapsedRef.current);
      }
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled]);

  // Activity listeners
  useEffect(() => {
    if (!enabled) return;

    const events = ["keydown", "mousedown", "touchstart", "input", "change"] as const;
    const handler = () => resetIdleTimer();

    events.forEach((evt) => document.addEventListener(evt, handler, { passive: true }));

    return () => {
      events.forEach((evt) => document.removeEventListener(evt, handler));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [enabled, resetIdleTimer]);

  // Visibility change — pause when hidden, resume on activity when visible
  useEffect(() => {
    if (!enabled) return;

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        pauseTracking();
      }
      // When visible again, don't auto-resume — wait for user activity via resetIdleTimer
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [enabled, pauseTracking]);

  const getElapsedSeconds = useCallback(() => elapsedRef.current, []);

  const reset = useCallback(() => {
    elapsedRef.current = 0;
    setElapsedSeconds(0);
    isActiveRef.current = false;
    isPausedRef.current = false;
    setIsActive(false);
    setIsPaused(false);
  }, []);

  return { elapsedSeconds, isActive, isPaused, getElapsedSeconds, reset };
}

