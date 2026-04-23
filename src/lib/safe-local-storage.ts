/**
 * safeSetItem — quota-aware localStorage write helper.
 *
 * Wraps `localStorage.setItem` with classification, audit logging, optional
 * critical-failure notification, and an `onFail` hook so callers can attempt
 * their own recovery (e.g. eviction + retry).
 *
 * Never throws. Returns a discriminated result so callers can branch on
 * success/failure without try/catch.
 *
 * NOTE: do NOT use this for auth-credential writes — `auth-resilience.ts`
 * already handles those with pinning + ensureSpaceForAuth.
 * See `mem://auth/phase3-storage-pressure`.
 */

export type SafeSetItemFailureCode = 'quota' | 'blocked' | 'unknown';

export type SafeSetItemResult =
  | { ok: true }
  | { ok: false; code: SafeSetItemFailureCode; error: unknown };

export interface SafeSetItemOptions {
  /** Logical scope name (e.g. 'backup-ledger.save') for audit routing. */
  scope?: string;
  /** If true, fire a sync notification so the user sees the failure. */
  critical?: boolean;
  /** Caller hook — invoked on failure for custom recovery (e.g. evict + retry). */
  onFail?: (code: SafeSetItemFailureCode, error: unknown) => void;
}

function classify(err: unknown): SafeSetItemFailureCode {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; code?: number };
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
      return 'quota';
    }
    if (e.name === 'SecurityError') return 'blocked';
  }
  return 'unknown';
}

export function safeSetItem(
  key: string,
  value: string,
  opts: SafeSetItemOptions = {}
): SafeSetItemResult {
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (error) {
    const code = classify(error);
    const approxBytes = (key?.length ?? 0) * 2 + (value?.length ?? 0) * 2;

    // Always log — operational signal
    // eslint-disable-next-line no-console
    console.error('[safeSetItem] FAILED', {
      key,
      scope: opts.scope,
      code,
      approxBytes,
      error,
    });

    // Forward to backend audit log (best-effort, never throws out)
    try {
      void import('@/lib/log-error').then(({ logError }) => {
        try {
          logError(error, {
            scope: opts.scope ?? 'safeSetItem',
            extra: { key, code, approxBytes },
          });
        } catch { /* swallow */ }
      }).catch(() => { /* swallow */ });
    } catch { /* swallow */ }

    // Surface to notification rail when critical
    if (opts.critical) {
      try {
        void import('@/lib/notification-center').then((mod) => {
          try {
            const addError = (mod as any).addErrorNotification;
            const addSync = (mod as any).addSyncNotification;
            const msg = `Storage is full — ${opts.scope ?? 'a record'} could not be saved. Free up space immediately.`;
            if (typeof addError === 'function') addError(msg);
            else if (typeof addSync === 'function') addSync(msg);
          } catch { /* swallow */ }
        }).catch(() => { /* swallow */ });
      } catch { /* swallow */ }
    }

    // Caller-supplied recovery hook
    try {
      opts.onFail?.(code, error);
    } catch { /* swallow */ }

    return { ok: false, code, error };
  }
}

/** Symmetric helper — never throws. */
export function safeRemoveItem(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
