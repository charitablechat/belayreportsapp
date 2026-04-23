

## C1 — Stop the T0-snapshot from clobbering mid-sync edits across all three report types

### Finding

The audit is correct. In `src/lib/atomic-sync-manager.ts` the same destructive pattern exists three times — at the **post-sync** IDB save (not at the snippet line numbers in the report; those point to the *empty-guard* recovery path):

| Report | Post-sync write | T0 snapshot variable |
|---|---|---|
| Inspection | line **832** (`saveInspectionOffline({ ...inspection, synced_at, updated_at, ... })`) | `inspection` (captured at function start, ~L317 area) |
| Training | line **1702** (`saveTrainingOffline({ ...training, ... })`) | `training` |
| Daily assessment | line **2504** (`saveDailyAssessmentOffline({ ...assessment, ... })`) | `assessment` |

The local variable holds T0 state. The 5–25 s server transaction runs. Any auto-save that landed in IDB during that window is overwritten by the spread of the stale T0 object, and `updated_at` is reset to `serverTimestamp` so the next `getUnsynced*` scan (drift tolerance 30 s in `local-data-guards.ts:25`, not 5 s — same idea) no longer flags it dirty. Edit lost, silently.

The same bug also exists at lines **2772 / 2800 / 2829** (a small finalize helper near the bottom of the file that does `saveXOffline({ ...x, synced_at: x.updated_at })`). Same fix applies.

### Fix

Add a small private helper, then call it from all three (six, including the finalize trio) post-sync write sites. No behavior change when no concurrent edit happened.

```ts
// New helper near the top of atomic-sync-manager.ts
type LiveGetter<T> = (id: string) => Promise<T | null | undefined>;
type LiveSaver<T>  = (record: T) => Promise<unknown>;

/**
 * C1: Post-sync save that won't clobber an auto-save that landed in IDB
 * during the server round-trip.
 *
 * - `t0Snapshot` is the parent record as captured at the start of sync.
 * - `t0UpdatedAtMs` is `Date.parse(t0Snapshot.updated_at)` (cache it once).
 * - If the live IDB record's updated_at is strictly newer than T0, we ONLY
 *   stamp `synced_at` on the live record and leave parent fields + updated_at
 *   intact. Otherwise we write the merged record as before.
 *
 * Treat any read/parse failure as "no concurrent edit" and fall through to
 * the legacy write — never block sync completion on a guard-read failure.
 */
async function safePostSyncSave<T extends { id: string; updated_at?: string | null }>(
  recordId: string,
  t0Snapshot: T,
  t0UpdatedAtMs: number,
  serverTimestamp: string,
  mergedFields: Partial<T>,            // e.g. { user_cleared_at: null, inspector: ... }
  getLive: LiveGetter<T>,
  save: LiveSaver<T>,
): Promise<void> {
  let live: T | null | undefined = null;
  try { live = await getLive(recordId); } catch { live = null; }

  const liveUpdatedMs = live?.updated_at ? Date.parse(live.updated_at) : NaN;
  const concurrentEdit =
    Number.isFinite(liveUpdatedMs) &&
    Number.isFinite(t0UpdatedAtMs) &&
    liveUpdatedMs > t0UpdatedAtMs;

  if (concurrentEdit && live) {
    // Preserve the live (newer) record; only stamp synced_at.
    await save({ ...live, synced_at: serverTimestamp });
    if (import.meta.env.DEV) {
      syncLog.log('[C1] Concurrent edit detected — preserved live record, stamped synced_at only', {
        id: recordId.substring(0, 8),
        t0: new Date(t0UpdatedAtMs).toISOString(),
        live: live.updated_at,
      });
    }
    return;
  }

  // No concurrent edit — original behavior.
  await save({
    ...t0Snapshot,
    ...mergedFields,
    synced_at: serverTimestamp,
    updated_at: serverTimestamp,
  });
}
```

Then patch six sites:

1. **Inspection post-sync** (L832): replace the `saveInspectionOffline({ ...inspection, ... })` block with a `safePostSyncSave(...)` call. Compute `t0UpdatedAtMs = Date.parse(inspection.updated_at)` once near the function start (right after `inspection` is captured) and pass it through. Pass `mergedFields = { user_cleared_at: null, inspector: inspectorProfile || { first_name: null, last_name: null, avatar_url: null } }`.
2. **Training post-sync** (L1702): same pattern with `saveTrainingOffline` and `getOfflineTraining`.
3. **Daily-assessment post-sync** (L2504): same pattern with `saveDailyAssessmentOffline` and `getOfflineDailyAssessment`.
4. **Inspection finalize** (L2772): replace `saveInspectionOffline({ ...inspection, synced_at: inspection.updated_at })` with the helper. T0 here is the same `inspection` arg passed into the finalize fn.
5. **Training finalize** (L2800): same.
6. **Daily-assessment finalize** (L2829): same.

The two empty-guard recovery writes at L641 and L1515 / L2320 are **out of scope** — they intentionally restore from server data after a guard trip and are not the T0-overwrite path.

### Why this is safe

- When no concurrent edit happened, the helper writes exactly the same payload as today (same fields, same `synced_at = updated_at = serverTimestamp`).
- When a concurrent edit happened, the live IDB record is preserved verbatim, and only `synced_at` is stamped to `serverTimestamp`. `updated_at` (newer than `synced_at`) makes `getUnsynced*` correctly re-flag it dirty for the next cycle — exactly the behavior we want.
- Read failure → fall through to legacy behavior (no regression).

### Out of scope

- The empty-guard recovery saves at L641 / L1515 / L2320 (different intent — restore-from-server).
- Child-row writes during the same window. They go through `reconcileAllChildTables` + `saveRelatedDataOffline` and aren't keyed on the parent's `updated_at`. Worth a follow-up audit but not C1.
- Lowering or raising `SYNC_DRIFT_TOLERANCE_MS`.

### Risk

Low. The helper is a strict superset of current behavior; the only new branch fires when `live.updated_at > t0.updated_at`, which is exactly the case the audit identified as currently silently lost.

### Verification

- `npx tsc --noEmit`.
- DEV: in `InspectionForm`, set a breakpoint inside the sync transaction (or temporarily insert `await new Promise(r => setTimeout(r, 8000))` in `syncInspection` just before `saveInspectionOffline`). While the transaction is in flight, type into a field and let the auto-save fire. Confirm:
  - Console shows `[C1] Concurrent edit detected — preserved live record, stamped synced_at only`.
  - The typed text remains in the form (and in IDB) after sync completes.
  - The next sync cycle picks the record back up and uploads the new edit (i.e. it's not stuck dirty forever).
- DEV: repeat for trainings and daily assessments.
- DEV: with no concurrent edit, confirm the existing happy path is unchanged (single `[SYNC_TERMINAL] align_synced_at CONFIRMED` line, no `[C1]` line, record is clean afterwards).

