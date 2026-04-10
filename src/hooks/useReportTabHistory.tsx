import { useEffect, useRef, useCallback, useState } from "react";
import { setReportTabActive } from "@/lib/navigation";
import { isMobile } from "@/lib/mobile-detection";

const TABLET_BREAKPOINT = 1024;

/**
 * Detect if the device should use tab-back navigation.
 * Covers phones (UA-based), tablets (touch + small screen), and iPads
 * (which report desktop UA but have touch support).
 */
function shouldUseTabHistory(): boolean {
  // UA-based mobile detection (phones + some tablets)
  if (isMobile()) return true;
  // Touch-capable device with screen narrower than tablet breakpoint
  if (navigator.maxTouchPoints > 0 && window.innerWidth < TABLET_BREAKPOINT) return true;
  return false;
}

/**
 * Hook that integrates report form tab navigation with the browser history stack.
 * On mobile/tablet, pressing the hardware back button navigates to the previous tab
 * instead of exiting the report. On the first tab, it triggers the leave dialog.
 */
export function useReportTabHistory(
  currentTab: string,
  setCurrentTab: (tab: string) => void,
  tabOrder: string[],
  onFirstTabBack: () => void,
) {
  const tabHistoryRef = useRef<string[]>([]);
  const isHandlingPopState = useRef(false);
  const [enabled, setEnabled] = useState(shouldUseTabHistory);

  // Re-evaluate on resize (handles tablet orientation changes)
  useEffect(() => {
    const onResize = () => setEnabled(shouldUseTabHistory());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Mark report tab navigation as active on mount (mobile/tablet only)
  useEffect(() => {
    if (!enabled) return;
    setReportTabActive(true);
    // Push initial history entry for the first tab
    window.history.pushState({ reportTab: tabOrder[0] }, "");
    tabHistoryRef.current = [tabOrder[0]];

    return () => {
      setReportTabActive(false);
      tabHistoryRef.current = [];
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle tab changes — push history entry
  const handleTabChange = useCallback(
    (newTab: string) => {
      setCurrentTab(newTab);
      if (!enabled) return;
      if (isHandlingPopState.current) return; // Don't push when navigating via back button

      window.history.pushState({ reportTab: newTab }, "");
      tabHistoryRef.current.push(newTab);
    },
    [setCurrentTab, enabled],
  );

  // Listen for popstate (hardware back button)
  useEffect(() => {
    if (!enabled) return;

    const handlePopState = (event: PopStateEvent) => {
      // Only handle if this is a report tab entry
      if (!event.state?.reportTab && tabHistoryRef.current.length <= 1) {
        // We've exhausted tab history — show the leave dialog
        // Re-push so the page doesn't actually navigate away
        window.history.pushState({ reportTab: currentTab }, "");
        onFirstTabBack();
        return;
      }

      if (tabHistoryRef.current.length > 1) {
        // Pop current tab, go to previous
        tabHistoryRef.current.pop();
        const previousTab = tabHistoryRef.current[tabHistoryRef.current.length - 1];
        if (previousTab) {
          isHandlingPopState.current = true;
          setCurrentTab(previousTab);
          isHandlingPopState.current = false;
        }
      } else {
        // Only one entry left = first tab — show leave dialog
        window.history.pushState({ reportTab: currentTab }, "");
        onFirstTabBack();
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [enabled, currentTab, setCurrentTab, onFirstTabBack]);

  return { handleTabChange };
}
