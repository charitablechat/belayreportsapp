/**
 * TEMPORARY DEV-ONLY photo-pipeline tracing.
 *
 * Active only when `import.meta.env.DEV === true`. In production builds Vite
 * dead-code-eliminates the body via the `if (import.meta.env.DEV)` guard at
 * every call site, so this file ships as a no-op.
 *
 * To remove after diagnosis:
 *   rg -l "photo-trace" src/ | xargs sed -i '/\[photo-trace/d'   (rough)
 * or simply delete this file + the guarded blocks (each tagged `[photo-trace ...]`).
 */

type TraceEntry = {
  ts: number;
  cid?: string;
  event: string;
  // free-form payload
  [k: string]: unknown;
};

const MAX_ENTRIES = 200;

declare global {
  interface Window {
    __photoTrace?: TraceEntry[];
  }
}

export function photoTrace(event: string, data: Record<string, unknown> = {}, cid?: string): void {
  if (!import.meta.env.DEV) return;
  try {
    const entry: TraceEntry = { ts: Date.now(), cid, event, ...data };
    if (typeof window !== 'undefined') {
      if (!window.__photoTrace) window.__photoTrace = [];
      window.__photoTrace.push(entry);
      if (window.__photoTrace.length > MAX_ENTRIES) {
        window.__photoTrace.splice(0, window.__photoTrace.length - MAX_ENTRIES);
      }
    }
    // Console mirror — easy to filter with "[photo-trace"
    // eslint-disable-next-line no-console
    console.debug(`[photo-trace ${event}]`, cid ? { cid, ...data } : data);
  } catch {
    /* never throw from a trace call */
  }
}

export function newPhotoCid(itemId: string): string {
  return `${itemId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
