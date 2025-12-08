import { useEffect, useRef, useState, useCallback } from "react";

interface SwipeNavigationOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  minSwipeDistance?: number;
  enabled?: boolean;
  /** Called during swipe with progress (0-1) for visual feedback */
  onSwipeProgress?: (progress: number, direction: 'left' | 'right' | null) => void;
  /** Whether this is the first tab (enables back navigation hint) */
  isFirstTab?: boolean;
}

interface SwipeState {
  isSwipingBack: boolean;
  swipeProgress: number;
}

/**
 * Custom hook for handling swipe gestures on mobile devices
 * Detects horizontal swipes and triggers callbacks for left/right swipes
 * Now includes swipe progress tracking for visual feedback
 */
export function useSwipeNavigation({
  onSwipeLeft,
  onSwipeRight,
  minSwipeDistance = 50,
  enabled = true,
  onSwipeProgress,
  isFirstTab = false,
}: SwipeNavigationOptions) {
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [swipeState, setSwipeState] = useState<SwipeState>({
    isSwipingBack: false,
    swipeProgress: 0,
  });

  const resetSwipeState = useCallback(() => {
    setSwipeState({ isSwipingBack: false, swipeProgress: 0 });
    onSwipeProgress?.(0, null);
  }, [onSwipeProgress]);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const container = containerRef.current;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (touchStartX.current === null || touchStartY.current === null) return;

      const touchCurrentX = e.touches[0].clientX;
      const touchCurrentY = e.touches[0].clientY;

      const deltaX = touchCurrentX - touchStartX.current;
      const deltaY = touchCurrentY - touchStartY.current;

      // Only track if horizontal swipe is more significant than vertical
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
        // Swiping right on first tab = back navigation hint
        if (deltaX > 0 && isFirstTab) {
          const progress = Math.min(deltaX / minSwipeDistance, 1);
          setSwipeState({
            isSwipingBack: progress >= 1,
            swipeProgress: progress,
          });
          onSwipeProgress?.(progress, 'right');
        } else if (deltaX < 0) {
          const progress = Math.min(Math.abs(deltaX) / minSwipeDistance, 1);
          onSwipeProgress?.(progress, 'left');
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchStartX.current === null || touchStartY.current === null) {
        resetSwipeState();
        return;
      }

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
      resetSwipeState();
    };

    const handleTouchCancel = () => {
      touchStartX.current = null;
      touchStartY.current = null;
      resetSwipeState();
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [onSwipeLeft, onSwipeRight, minSwipeDistance, enabled, isFirstTab, onSwipeProgress, resetSwipeState]);

  return { containerRef, swipeState };
}
