/**
 * Per-inspection serialization lock for remote pushes.
 *
 * Scope (intentionally narrow):
 *   - Serializes only remote pushes (`pushInspectionToRemote`) for the SAME
 *     inspection id. Different inspection ids run independently.
 *   - Releases on both success and failure (try/finally inside).
 *   - Does NOT wrap local/offline persistence — IDB writes remain unblocked.
 *
 * Why: rapid successive autosaves on the same inspection can each enter
 * the saver while temp-id rows are still in the React snapshot. With
 * deterministic temp-id → real-id reuse + upsert(onConflict:"id") this
 * mutex closes the remaining race window where two pushes overlap and
 * the second observes pre-microtask state.
 */
const locks = new Map<string, Promise<unknown>>();

export async function withInspectionPushLock<T>(
  inspectionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = locks.get(inspectionId) ?? Promise.resolve();
  let release!: () => void;
  const mine = prev.then(
    () => new Promise<void>((resolve) => { release = resolve; }),
  );
  locks.set(inspectionId, mine);
  try {
    await prev.catch(() => { /* don't propagate predecessor failures */ });
    return await fn();
  } finally {
    release();
    // GC: only delete if no newer waiter chained on top of us.
    if (locks.get(inspectionId) === mine) {
      locks.delete(inspectionId);
    }
  }
}

/** Test-only: clear all locks between tests. */
export function __resetInspectionPushLocksForTests(): void {
  locks.clear();
}
