/**
 * Audit M4 — shared IDB-closing-error helper.
 *
 * iOS Safari (and to a lesser extent WebKit on iPadOS) aggressively suspends
 * the page when it enters bfcache (back/forward navigation, tab switch,
 * device lock). When the page resumes, any IndexedDB transaction that was
 * mid-flight at suspend time rejects with:
 *
 *   InvalidStateError: Failed to execute '<method>' on 'IDBDatabase': The
 *   database connection is closing
 *
 * The same shape can also surface mid-walk on cursor iteration when the
 * underlying connection is closed by the browser before the next step
 * resolves.
 *
 * This is NOT a real IDB health problem and must not trip:
 *   - the circuit breaker (recordIndexedDBFailure → cooldown)
 *   - the silent error boundary's `console.error` (Sentry noise)
 *
 * The helper is intentionally tiny and dependency-free so it can be imported
 * from photo-cache.ts, offline-storage.ts boundaries, or any future
 * resilience helper without pulling in the whole offline-storage module.
 *
 * Originally extracted from PR #66 / PR #69 (photo-cache hardening).
 */

/**
 * Returns true iff `err` looks like the iOS Safari "database connection is
 * closing" rejection. Tolerant of duck-typed error shapes from libraries
 * like `idb` that may strip the prototype on cross-realm rethrows.
 */
export function isIdbClosingError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; message?: unknown };
  if (e.name === 'InvalidStateError') return true;
  if (
    typeof e.message === 'string' &&
    /database connection is closing|InvalidStateError/i.test(e.message)
  ) {
    return true;
  }
  return false;
}

/**
 * Returns true iff the document is currently hidden (bfcache, tab switch,
 * device lock). Helpers that walk IDB cursors should skip work in this
 * state because the connection is at high risk of being terminated mid-walk.
 *
 * SSR-safe: returns false when `document` is undefined (e.g. node tests or
 * pre-hydration server render).
 */
export function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}
