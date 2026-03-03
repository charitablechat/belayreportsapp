/**
 * Session-level navigation depth tracker.
 * Counts actual in-app navigations so goBack() can reliably
 * decide whether navigate(-1) has a real page to return to.
 */
let navigationDepth = 0;

export function trackNavigation() {
  navigationDepth++;
}

/**
 * Navigate back if there is a real in-app page to return to,
 * otherwise fall back to /dashboard.
 */
export function goBack(navigate: (to: string | number) => void) {
  navigationDepth = 0;
  navigate("/dashboard");
}
