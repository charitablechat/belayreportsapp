/**
 * Navigate back using browser history, with a fallback to /dashboard
 * for users who opened a direct link (no prior history).
 */
export function goBack(navigate: (to: string | number) => void) {
  if (window.history.length > 1) {
    navigate(-1);
  } else {
    navigate("/dashboard");
  }
}
