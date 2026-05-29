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
 * the saver while temp-id rows are still in the React snapshot, generating
 * two different real UUIDs for the same logical row. Combined with
 * deterministic temp-id → real-id reuse + upsert(onConflict:"id"), this
 * mutex closes the duplicate-insert race window.
 */
const locks = new Map<string, Promise<unknown>>();

export async function withInspectionPushLock<T>(
  inspectionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = locks.get(inspectionId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(inspectionId, prev.then(() => gate));
  try {
    await prev;
    return await fn();
  } finally {
    release();
    // GC: only delete if we're still the tail of the chain.
    queueMicrotask(() => {
      const current = locks.get(inspectionId);
      // Best-effort cleanup; if a newer waiter chained on, leave it.
      if (current && current === prev.then(() => gate)) {
        locks.delete(inspectionId);
      }
    });
  }
}

/** Test-only: clear all locks between tests. */
export function __resetInspectionPushLocksForTests(): void {
  locks.clear();
}
