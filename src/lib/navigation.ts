/**
 * Session-level navigation depth tracker.
 * Counts actual in-app navigations so goBack() can reliably
 * decide whether navigate(-1) has a real page to return to.
 */
let navigationDepth = 0;
let overlayActive = false;

export function setOverlayActive(active: boolean) {
  overlayActive = active;
}

export function isOverlayActive() {
  return overlayActive;
}

export function trackNavigation() {
  navigationDepth++;
}

/**
 * Navigate back if there is a real in-app page to return to,
 * otherwise fall back to /dashboard.
 */
export function getNavigationDepth() {
  return navigationDepth;
}

export function decrementNavigation() {
  if (navigationDepth > 0) {
    navigationDepth--;
  }
}

/**
 * Navigate back if there is a real in-app page to return to,
 * otherwise fall back to /dashboard.
 */
export function goBack(navigate: (to: string | number) => void) {
  if (navigationDepth > 0) {
    navigationDepth--;
    navigate(-1);
  } else {
    navigate("/dashboard");
  }
}
