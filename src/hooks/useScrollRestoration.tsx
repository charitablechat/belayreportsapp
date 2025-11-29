import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

interface ScrollPosition {
  x: number;
  y: number;
  timestamp: number;
}

const scrollPositions = new Map<string, ScrollPosition>();
const SCROLL_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Hook to save and restore scroll positions on navigation
 * Automatically cleans up old scroll positions after 5 minutes
 */
export const useScrollRestoration = (enabled: boolean = true) => {
  const location = useLocation();
  const lastPathRef = useRef<string>(location.pathname);
  const isRestoringRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const currentPath = location.pathname;
    const lastPath = lastPathRef.current;

    // Save scroll position for the previous path
    if (lastPath !== currentPath) {
      const scrollPosition = {
        x: window.scrollX,
        y: window.scrollY,
        timestamp: Date.now(),
      };
      scrollPositions.set(lastPath, scrollPosition);
      
      if (import.meta.env.DEV) {
        console.log('[Scroll Restoration] Saved:', lastPath, scrollPosition);
      }
    }

    // Restore scroll position for current path
    const savedPosition = scrollPositions.get(currentPath);
    if (savedPosition) {
      // Check if position is still valid (within cache duration)
      const age = Date.now() - savedPosition.timestamp;
      if (age < SCROLL_CACHE_DURATION) {
        isRestoringRef.current = true;
        
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          window.scrollTo(savedPosition.x, savedPosition.y);
          isRestoringRef.current = false;
          
          if (import.meta.env.DEV) {
            console.log('[Scroll Restoration] Restored:', currentPath, savedPosition);
          }
        });
      } else {
        // Remove stale position
        scrollPositions.delete(currentPath);
      }
    }

    lastPathRef.current = currentPath;
  }, [location.pathname, enabled]);

  // Cleanup old scroll positions periodically
  useEffect(() => {
    if (!enabled) return;

    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const keysToDelete: string[] = [];
      
      scrollPositions.forEach((position, key) => {
        if (now - position.timestamp > SCROLL_CACHE_DURATION) {
          keysToDelete.push(key);
        }
      });
      
      keysToDelete.forEach(key => scrollPositions.delete(key));
      
      if (import.meta.env.DEV && keysToDelete.length > 0) {
        console.log('[Scroll Restoration] Cleaned up:', keysToDelete.length, 'stale positions');
      }
    }, 60 * 1000); // Check every minute

    return () => clearInterval(cleanupInterval);
  }, [enabled]);

  // Clear all scroll positions when app closes or is backgrounded (mobile fix)
  useEffect(() => {
    if (!enabled) return;

    const handleBeforeUnload = () => {
      scrollPositions.clear();
      if (import.meta.env.DEV) {
        console.log('[Scroll Restoration] Cleared all scroll positions on app close');
      }
    };

    // iOS Safari fix: pagehide is more reliable than beforeunload
    const handlePageHide = () => {
      scrollPositions.clear();
      if (import.meta.env.DEV) {
        console.log('[Scroll Restoration] Cleared all scroll positions on page hide');
      }
    };

    // Clear scroll positions when app is hidden for more than 5 minutes
    let hiddenTime = 0;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenTime = Date.now();
      } else {
        const timeDiff = Date.now() - hiddenTime;
        if (timeDiff > 5 * 60 * 1000) { // 5 minutes
          scrollPositions.clear();
          if (import.meta.env.DEV) {
            console.log('[Scroll Restoration] Cleared stale scroll positions after long background');
          }
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled]);

  return {
    isRestoring: isRestoringRef.current,
  };
};
