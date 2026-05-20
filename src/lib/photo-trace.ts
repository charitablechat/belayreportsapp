/**
 * TEMPORARY DEV/opt-in photo-pipeline tracing.
 *
 * Enabled when ANY of these are true:
 *   - `import.meta.env.DEV === true` (local dev server)
 *   - URL contains `?photoTrace=1` (also persists to localStorage)
 *   - `localStorage.photo_trace === '1'` (sticky from a previous visit)
 *
 * Disable for the current page load with `?photoTrace=0` (clears localStorage).
 *
 * To remove after diagnosis: delete this file + every `[photo-trace ...]`
 * call site (search prefix `[photo-trace`).
 */

type TraceEntry = {
  ts: number;
  cid?: string;
  event: string;
  [k: string]: unknown;
};

const MAX_ENTRIES = 200;
const LS_KEY = 'photo_trace';
let _enabled: boolean | null = null;

declare global {
  interface Window {
    __photoTrace?: TraceEntry[];
  }
}

/**
 * Runtime check for whether photo tracing should record. Cached per page load.
 * Survives SPA navigation via localStorage once `?photoTrace=1` has been hit.
 */
export function isPhotoTraceEnabled(): boolean {
  if (_enabled !== null) return _enabled;
  try {
    if (typeof window !== 'undefined') {
      const qs = new URLSearchParams(window.location.search);
      const flag = qs.get('photoTrace');
      if (flag === '0' || flag === 'off') {
        try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
        return (_enabled = false);
      }
      if (flag === '1' || flag === 'on') {
        try { localStorage.setItem(LS_KEY, '1'); } catch { /* ignore */ }
        return (_enabled = true);
      }
    }
    if (import.meta.env.DEV) return (_enabled = true);
    if (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY) === '1') {
      return (_enabled = true);
    }
  } catch {
    /* fall through */
  }
  return (_enabled = false);
}

export function photoTrace(event: string, data: Record<string, unknown> = {}, cid?: string): void {
  if (!isPhotoTraceEnabled()) return;
  try {
    const entry: TraceEntry = { ts: Date.now(), cid, event, ...data };
    if (typeof window !== 'undefined') {
      if (!window.__photoTrace) window.__photoTrace = [];
      window.__photoTrace.push(entry);
      if (window.__photoTrace.length > MAX_ENTRIES) {
        window.__photoTrace.splice(0, window.__photoTrace.length - MAX_ENTRIES);
      }
    }
    // eslint-disable-next-line no-console
    console.debug(`[photo-trace ${event}]`, cid ? { cid, ...data } : data);
  } catch {
    /* never throw from a trace call */
  }
}

export function newPhotoCid(itemId: string): string {
  return `${itemId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
