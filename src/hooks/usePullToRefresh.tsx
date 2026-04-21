import { useEffect, useRef, useState, useCallback } from 'react';
import { isMobile } from '@/lib/mobile-detection';

export type PullState = 'idle' | 'pulling' | 'ready' | 'refreshing';

interface UsePullToRefreshProps {
  onRefresh: () => Promise<void>;
  isRefreshing?: boolean;
  threshold?: number;
  disabled?: boolean;
}

export const usePullToRefresh = ({
  onRefresh,
  isRefreshing = false,
  threshold = 80,
  disabled = false,
}: UsePullToRefreshProps) => {
  const [isPulling, setIsPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [shouldTriggerRefresh, setShouldTriggerRefresh] = useState(false);
  const [pullProgress, setPullProgress] = useState(0); // 0-100 percentage
  const [pullState, setPullState] = useState<PullState>('idle');
  const startY = useRef(0);
  const currentY = useRef(0);
  const lastRefreshTime = useRef(0);
  const isMobileDevice = isMobile();

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled || !isMobileDevice || isRefreshing) return;
    
    // Only start pull if we're at the top of the page
    if (window.scrollY === 0) {
      startY.current = e.touches[0].clientY;
      setIsPulling(true);
      setPullState('pulling');
    }
  }, [disabled, isMobileDevice, isRefreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isPulling || disabled || !isMobileDevice || isRefreshing) return;

    currentY.current = e.touches[0].clientY;
    const distance = currentY.current - startY.current;

    // Only track pull down, not up, and only when at top of page
    if (distance > 0 && window.scrollY === 0) {
      // Apply resistance for smoother feel
      const resistance = 0.5;
      const adjustedDistance = distance * resistance;
      setPullDistance(Math.min(adjustedDistance, threshold * 1.5));

      // Calculate pull progress (0-100%)
      const progress = Math.min((adjustedDistance / threshold) * 100, 100);
      setPullProgress(progress);

      // Check if we've reached threshold
      if (adjustedDistance >= threshold) {
        setShouldTriggerRefresh(true);
        setPullState('ready');
      } else {
        setShouldTriggerRefresh(false);
        setPullState('pulling');
      }

      // Prevent default scrolling when actively pulling (not just touching)
      if (adjustedDistance > 10) {
        e.preventDefault();
      }
    }
  }, [isPulling, disabled, isMobileDevice, isRefreshing, threshold]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling || disabled || !isMobileDevice) return;

    setIsPulling(false);

    if (shouldTriggerRefresh && !isRefreshing) {
      setPullState('refreshing');
      // Check cooldown period (2 seconds)
      const now = Date.now();
      const timeSinceLastRefresh = now - lastRefreshTime.current;
      
      if (timeSinceLastRefresh < 2000) {
        if (import.meta.env.DEV) {
          console.log('[Pull to Refresh] Cooldown active, ignoring refresh');
        }
      } else if (!navigator.onLine) {
        // B6: offline — skip the network refresh to avoid Chrome's "No internet"
        // page swallowing our offline-capable shell. Dispatch a sync-events ping
        // so any local indicators (sync pulse, etc.) still react to the gesture.
        if (import.meta.env.DEV) {
          console.log('[Pull to Refresh] Offline — skipping network refresh');
        }
        try {
          window.dispatchEvent(new CustomEvent('sync:pull-refresh-offline'));
        } catch {
          // no-op
        }
      } else {
        try {
          lastRefreshTime.current = now;
          await onRefresh();
        } catch (error) {
          console.error('[Pull to Refresh] Error:', error);
        }
      }
    }

    // Reset state
    setPullDistance(0);
    setShouldTriggerRefresh(false);
    setPullProgress(0);
    setPullState('idle');
    startY.current = 0;
    currentY.current = 0;
  }, [isPulling, disabled, isMobileDevice, shouldTriggerRefresh, isRefreshing, onRefresh]);

  useEffect(() => {
    if (!isMobileDevice || disabled) return;

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, isMobileDevice, disabled]);

  return {
    isPulling,
    pullDistance,
    shouldTriggerRefresh,
    isActive: isPulling && pullDistance > 0,
    pullProgress, // 0-100 percentage for visual feedback
    pullState, // 'idle' | 'pulling' | 'ready' | 'refreshing'
  };
};
