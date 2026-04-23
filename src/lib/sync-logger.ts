/**
 * Shared debug logger for sync subsystems.
 *
 * Silent in production by default. Enable at runtime in the field with:
 *   localStorage.setItem('debug_sync', '1'); location.reload();
 *
 * Errors always pass through — they are operational signal.
 */
const isDev = import.meta.env.DEV;
let runtimeForce: boolean | null = null;

function isDebugEnabled(): boolean {
  if (isDev) return true;
  if (runtimeForce !== null) return runtimeForce;
  try {
    runtimeForce = localStorage.getItem('debug_sync') === '1';
  } catch {
    runtimeForce = false;
  }
  return runtimeForce;
}

export const syncLog = {
  log: (...a: unknown[]) => {
    if (isDebugEnabled()) console.log(...a);
  },
  warn: (...a: unknown[]) => {
    if (isDebugEnabled()) console.warn(...a);
  },
  // errors always pass through — operational signal
  error: (...a: unknown[]) => console.error(...a),
};
