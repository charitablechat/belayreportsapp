import { useEffect, useRef } from 'react';
import { triggerScrollBoundaryHaptic } from '@/lib/haptics';

/**
 * Hook to detect when user reaches scroll boundaries (top/bottom)
 * and trigger haptic feedback
 */
export const useScrollBoundaryDetection = (enabled: boolean = true) => {
  const lastScrollYRef = useRef(0);
  const cooldownRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const handleScroll = () => {
      // Prevent excessive haptic feedback
      if (cooldownRef.current) return;

      const currentScrollY = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const threshold = 10; // 10px threshold

      // Detect top boundary
      if (currentScrollY <= threshold && lastScrollYRef.current > threshold) {
        triggerScrollBoundaryHaptic();
        cooldownRef.current = true;
        setTimeout(() => {
          cooldownRef.current = false;
        }, 500); // 500ms cooldown
      }
      
      // Detect bottom boundary
      if (currentScrollY >= maxScroll - threshold && lastScrollYRef.current < maxScroll - threshold) {
        triggerScrollBoundaryHaptic();
        cooldownRef.current = true;
        setTimeout(() => {
          cooldownRef.current = false;
        }, 500); // 500ms cooldown
      }

      lastScrollYRef.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [enabled]);
};
