import { useEffect, useRef } from 'react';
import { isMobile } from '@/lib/mobile-detection';

/**
 * Debounce utility for limiting function calls
 */
function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };
    
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

/**
 * Hook to handle keyboard avoidance on mobile devices
 * Automatically scrolls focused input into view when keyboard appears
 */
export const useKeyboardAvoidance = () => {
  const isMobileDevice = isMobile();
  const debouncedHandleRef = useRef<((...args: any[]) => void) | null>(null);

  useEffect(() => {
    if (!isMobileDevice) return;

    const handleFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      
      // Only handle input, textarea, and contenteditable elements
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        // Wait for keyboard to appear (300ms delay)
        setTimeout(() => {
          // Scroll element into view with smooth behavior
          target.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
          });
        }, 300);
      }
    };

    // Handle visual viewport resize (keyboard appearance) with debounce
    const handleViewportResize = () => {
      if (window.visualViewport) {
        const viewport = window.visualViewport;
        const activeElement = document.activeElement as HTMLElement;
        
        // If an input is focused and viewport height decreased (keyboard appeared)
        if (
          activeElement &&
          (activeElement.tagName === 'INPUT' ||
           activeElement.tagName === 'TEXTAREA' ||
           activeElement.isContentEditable)
        ) {
          // Adjust scroll to keep input visible
          const elementRect = activeElement.getBoundingClientRect();
          const viewportHeight = viewport.height;
          
          // If element is below visible viewport, scroll it into view
          if (elementRect.bottom > viewportHeight) {
            window.scrollBy({
              top: elementRect.bottom - viewportHeight + 20,
              behavior: 'smooth'
            });
          }
        }
      }
    };

    // Create debounced version (150ms delay to smooth rapid fires)
    debouncedHandleRef.current = debounce(handleViewportResize, 150);

    // Add event listeners
    document.addEventListener('focusin', handleFocus, { capture: true });
    
    if (window.visualViewport && debouncedHandleRef.current) {
      window.visualViewport.addEventListener('resize', debouncedHandleRef.current);
    }

    return () => {
      document.removeEventListener('focusin', handleFocus, { capture: true });
      
      if (window.visualViewport && debouncedHandleRef.current) {
        window.visualViewport.removeEventListener('resize', debouncedHandleRef.current);
      }
    };
  }, [isMobileDevice]);
};

