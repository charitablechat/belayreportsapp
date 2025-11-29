import * as React from "react";
import { isMobile as isMobileUserAgent } from "@/lib/mobile-detection";

const MOBILE_BREAKPOINT = 768;

/**
 * Unified mobile detection combining screen size and user agent
 * - Screen width < 768px (responsive design breakpoint)
 * - Mobile user agent (true mobile devices)
 * Returns true if EITHER condition is met
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const checkMobile = () => {
      const isMobileScreen = window.innerWidth < MOBILE_BREAKPOINT;
      const isMobileDevice = isMobileUserAgent();
      
      // True if either screen size is mobile OR device is mobile
      setIsMobile(isMobileScreen || isMobileDevice);
    };

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    mql.addEventListener("change", checkMobile);
    checkMobile();
    
    return () => mql.removeEventListener("change", checkMobile);
  }, []);

  return !!isMobile;
}
