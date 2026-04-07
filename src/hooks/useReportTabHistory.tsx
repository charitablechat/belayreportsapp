import { useEffect, useRef, useCallback } from "react";
import { setReportTabActive } from "@/lib/navigation";
import { isMobile } from "@/lib/mobile-detection";

/**
 * Hook that integrates report form tab navigation with the browser history stack.
 * On mobile, pressing the hardware back button navigates to the previous tab
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
  const isMobileDevice = isMobile();

  // Mark report tab navigation as active on mount (mobile only)
  useEffect(() => {
    if (!isMobileDevice) return;
    setReportTabActive(true);
    // Push initial history entry for the first tab
    window.history.pushState({ reportTab: tabOrder[0] }, "");
    tabHistoryRef.current = [tabOrder[0]];

    return () => {
      setReportTabActive(false);
      tabHistoryRef.current = [];
    };
  }, [isMobileDevice]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle tab changes — push history entry
  const handleTabChange = useCallback(
    (newTab: string) => {
      setCurrentTab(newTab);
      if (!isMobileDevice) return;
      if (isHandlingPopState.current) return; // Don't push when navigating via back button

      window.history.pushState({ reportTab: newTab }, "");
      tabHistoryRef.current.push(newTab);
    },
    [setCurrentTab, isMobileDevice],
  );

  // Listen for popstate (hardware back button)
  useEffect(() => {
    if (!isMobileDevice) return;

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
  }, [isMobileDevice, currentTab, setCurrentTab, onFirstTabBack]);

  return { handleTabChange };
}
