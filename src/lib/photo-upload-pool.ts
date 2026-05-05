/**
 * Audit C2.1 — global concurrent-compression cap.
 *
 * Why: `<PhotoCapture />` instances each hold their own `uploadMutexRef`,
 * which serialises uploads WITHIN one section but NOT across sections.
 * A multi-section inspection can render 20+ `<PhotoCapture />` panels;
 * if a user taps "Camera" in section A and then "Camera" in section B
 * before A finishes, both proceed in parallel. Each `compressImage` call
 * holds an ImageBitmap (potentially tens of MB on a 50MP source) plus
 * scratch canvas memory plus a heic2any worker. On a 3-4 GB Android
 * tablet that quickly becomes a tab-kill scenario.
 *
 * What: a process-wide FIFO semaphore that caps concurrent compressions
 * at `MAX_CONCURRENT_COMPRESSIONS`. Per-component mutexes still apply
 * (and still own cancellation), but they now contend for a shared pool
 * rather than running in parallel.
 *
 * The pool is intentionally tiny and dependency-free: a counter, a queue
 * of waiter resolvers, and a hand-off-on-release rule that prevents the
 * bookkeeping `active` count from going stale between resolve and the
 * caller's `await` returning.
 */

const MAX_CONCURRENT_COMPRESSIONS = 2;

let active = 0;
const waiters: Array<() => void> = [];

/**
 * Internal: visible for tests only. Returns the current pool state so
 * specs can assert "no slot leaked" after a sequence of acquires/releases.
 */
export function _photoPoolStateForTests(): {
  active: number;
  waiting: number;
  maxConcurrent: number;
} {
  return {
    active,
    waiting: waiters.length,
    maxConcurrent: MAX_CONCURRENT_COMPRESSIONS,
  };
}

/**
 * Internal: visible for tests only. Resets pool state between specs so
 * test ordering doesn't leak across files.
 */
export function _resetPhotoPoolForTests(): void {
  active = 0;
  waiters.length = 0;
}

/**
 * Acquire a compression slot. Resolves immediately when at least one
 * slot is free; otherwise waits in FIFO order until a previous holder
 * calls the returned `release` function.
 *
 * The returned `release` is idempotent — calling it twice is safe and
 * the second call is a no-op.
 *
 * Pattern:
 * ```
 * const release = await acquireCompressionSlot();
 * try {
 *   processedFile = await compressImage(...);
 * } finally {
 *   release();
 * }
 * ```
 */
export async function acquireCompressionSlot(): Promise<() => void> {
  if (active < MAX_CONCURRENT_COMPRESSIONS) {
    active++;
  } else {
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
    // The releasing holder hands the slot off via resolve(); active count
    // is preserved across the hand-off so we don't increment again here.
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiters.shift();
    if (next) {
      // Hand off the slot directly to the next waiter — `active` stays
      // pinned at MAX_CONCURRENT_COMPRESSIONS until they release.
      next();
    } else {
      active--;
    }
  };
}
