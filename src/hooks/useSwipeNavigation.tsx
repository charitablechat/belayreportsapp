import { useEffect, useRef } from "react";

interface SwipeNavigationOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  minSwipeDistance?: number;
  enabled?: boolean;
}

/**
 * Custom hook for handling swipe gestures on mobile devices
 * Detects horizontal swipes and triggers callbacks for left/right swipes
 */
export function useSwipeNavigation({
  onSwipeLeft,
  onSwipeRight,
  minSwipeDistance = 50,
  enabled = true,
}: SwipeNavigationOptions) {
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const container = containerRef.current;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchStartX.current === null || touchStartY.current === null) return;

      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;

      const deltaX = touchEndX - touchStartX.current;
      const deltaY = touchEndY - touchStartY.current;

      // Only trigger if horizontal swipe is more significant than vertical
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        if (Math.abs(deltaX) >= minSwipeDistance) {
          if (deltaX > 0 && onSwipeRight) {
            onSwipeRight();
          } else if (deltaX < 0 && onSwipeLeft) {
            onSwipeLeft();
          }
        }
      }

      touchStartX.current = null;
      touchStartY.current = null;
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [onSwipeLeft, onSwipeRight, minSwipeDistance, enabled]);

  return containerRef;
}
