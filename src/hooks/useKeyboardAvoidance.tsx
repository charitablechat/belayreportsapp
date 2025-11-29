import { useEffect } from 'react';
import { isMobile } from '@/lib/mobile-detection';

/**
 * Hook to handle keyboard avoidance on mobile devices
 * Automatically scrolls focused input into view when keyboard appears
 */
export const useKeyboardAvoidance = () => {
  const isMobileDevice = isMobile();

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

    // Handle visual viewport resize (keyboard appearance)
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

    // Add event listeners
    document.addEventListener('focusin', handleFocus, { capture: true });
    
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportResize);
    }

    return () => {
      document.removeEventListener('focusin', handleFocus, { capture: true });
      
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleViewportResize);
      }
    };
  }, [isMobileDevice]);
};

