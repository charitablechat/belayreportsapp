

## S3 + S4: Stop sync loops and stop wiping queued operations

Two surgical fixes to `src/lib/atomic-sync-manager.ts` and `src/hooks/useAutoSync.tsx`. No schema changes.

---

### S3 — Treat `align_synced_at` as advisory, not fatal

**Root cause.** The transaction's final step already runs:
```ts
{ table: 'inspections', operation: 'update',
  data: { synced_at: now(), last_sync_source: 'main_thread' }, ... }
```
The server has committed. The follow-up `align_synced_at` RPC only nudges `synced_at` to match `updated_at`. If that RPC throws (network blip, lock, transient PostgREST error), we currently throw out of `syncInspectionAtomic`, never write the local `synced_at`, and the record gets re-synced forever.

**Fix.** In all three helpers (`syncInspectionAtomic` ~659–672, `syncTrainingAtomic` ~1462–1475, `syncDailyAssessmentAtomic` ~2199–2212), replace the strict throw with a soft fallback:

```ts
const { data: aligned, error: alignError } = await supabase.rpc('align_synced_at', {
  p_table_name: 'inspections',
  p_record_id: inspectionId,
});

let serverTimestamp: string;
const alignedData = aligned as any;

if (alignError || !alignedData || alignedData.error) {
  // Non-fatal: transaction already committed synced_at on the server.
  // Use the timestamp we just wrote so local state advances and the
  // record stops re-queueing. align_synced_at retries naturally next cycle.
  console.warn(
    '[Atomic Sync] align_synced_at non-fatal failure — using transaction timestamp',
    { table: 'inspections', id: inspectionId, alignError: alignError?.message, aligned }
  );
  serverTimestamp = (steps[steps.length - 1].data as any).synced_at;
} else {
  serverTimestamp = alignedData.updated_at;
  console.log('%c[SYNC_TERMINAL] align_synced_at CONFIRMED %c%s', /* unchanged */ );
}

await saveInspectionOffline({ ...inspection, synced_at: serverTimestamp, updated_at: serverTimestamp, ... });
```

Apply the identical shape to trainings and daily assessments, swapping `'inspections'` / `inspectionId` for the right ids and capturing the final-step timestamp from each helper's own `steps` array.

**Why this is safe.** `executeTransaction` already enforces row-count > 0 on the final `update` (see `transaction-manager.ts`), so we know the parent row exists and `synced_at` was set on the server. The only thing `align_synced_at` adds is collapsing `synced_at` onto `updated_at`; if it fails, the worst case is one extra `isLocalDataNewer` false-positive next cycle, which the existing local-first guards already absorb.

---

### S4 — Stop bulk-wiping non-soft-delete queued operations

**Root cause.** `queueOperation` in `src/lib/offline-storage.ts` is called from `Dashboard.tsx`, `NewInspection.tsx`, `InspectionForm.tsx`, and `PhotoGallery.tsx` for `create`/`update`/`delete` scenarios. The auto-sync pipeline only processes the `update`-with-`deleted_at` subset (via `processQueuedSoftDeletes`) and then calls `clearAllQueuedOperations()` in two places (lines 297–303 and 401–411 of `useAutoSync.tsx`), wiping every other entry without executing it. Per-record cleanup already exists at `atomic-sync-manager.ts` lines 715–730 / 1527+ for entries the transaction successfully handled, so the bulk clear is purely a data-loss net.

**Fix.** Replace the bulk `clearAllQueued*Operations()` calls with a "clear only what we successfully processed" pass. New helper in `src/lib/queued-soft-delete-processor.ts`:

```ts
/**
 * Remove queue entries that are stale relative to current IDB state:
 *   - soft-delete entries whose target record is already deleted_at != null locally
 *   - create/update entries whose target record is already synced (synced_at >= updated_at)
 * Leaves anything that still represents real pending work.
 */
export async function pruneCompletedQueuedOperations(): Promise<{
  inspections: number; trainings: number; assessments: number;
}> { /* per-store loop using the existing get/remove helpers */ }
```

Logic per entry:
1. Look up the record (`getInspection` / `getTraining` / `getAssessment`).
2. If the record is missing locally → drop the entry (orphan).
3. If `op.type === 'update'` and `op.data.deleted_at` is set and the local record's `deleted_at` is also set → drop (already applied).
4. If `op.type === 'create' | 'update'` (non-soft-delete) and the local record has `synced_at && synced_at >= updated_at` → drop (transaction already covered it).
5. Otherwise → keep. It still represents work the soft-delete processor / transaction will pick up.

Then in `src/hooks/useAutoSync.tsx`:

- **Line 297–303 block (early-exit path):** after calling `processQueuedSoftDeletes`, replace the three `clearAllQueued*` calls with a single `await pruneCompletedQueuedOperations()`. If it returns >0, log; do not blanket-clear.
- **Line 401–411 block (post-sync cleanup):** same swap.
- Keep the bulk `clearAllQueued*` exports — `DataRecoveryTool.tsx` legitimately uses them for the admin "clear all" buttons.

**Why this is safe.** The atomic sync helpers already self-clean entries they processed (atomic-sync-manager.ts lines 715–730, 1527+, equivalent for assessments). The soft-delete processor self-removes entries it applied. The new pruner only drops entries whose work is already represented in IDB state. Anything still pending stays in the queue for the next consumer to pick up — and if a consumer never appears for a given op type, that's a bug to surface, not silently delete.

---

### Files

- `src/lib/atomic-sync-manager.ts` — three `align_synced_at` blocks soften from throw to warn-and-fallback (~659–680, ~1462–1483, ~2199–2220).
- `src/lib/queued-soft-delete-processor.ts` — add `pruneCompletedQueuedOperations`.
- `src/hooks/useAutoSync.tsx` — replace two `clearAllQueued*` Promise.all blocks with `pruneCompletedQueuedOperations()`. Keep import of bulk-clear helpers if any remaining call sites need them; otherwise drop from the import list.

### Out of scope

- Not removing `clearAllQueuedOperations` exports (admin recovery tool uses them).
- Not building a real consumer for `create`/`update` operations entries — those code paths already double-write via `saveInspectionOffline` + transaction sync; the queue entry is belt-and-suspenders. Pruning is enough to stop the loss without disturbing producers.
- Not folding `align_synced_at` into the transaction itself — possible but requires a new RPC signature; the soft-fallback delivers the same loop-prevention without an RPC change.

### Risk

Low. S3 strictly broadens the success path (we now succeed on more cases than before; we never succeed on a case that previously failed correctly, because the row-count guard in `executeTransaction` still gates the actual write). S4 changes a destructive bulk-clear into a conservative state-aware prune, so worst case some stale entries linger one extra cycle — vs. today's worst case of silently dropped writes.

