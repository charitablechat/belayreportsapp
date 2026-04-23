

## C4 — Make reconciled deletions recoverable on transaction failure

### Finding

`reconcileAllChildTables` runs **before** the upsert transaction in all three sync paths and in the `InspectionForm` manual save. Reconcile hard-deletes server child rows that are missing locally. If anything after reconcile fails (transaction error, network drop, abort), `rollbackTransaction` only undoes the steps it executed — the deleted child rows are gone from the server. Combined with C2's empty-local-guard, a follow-up sync can leave the user with a server copy that's missing those rows permanently.

`report_deleted_items` already captures pre-images in `sync-reconciliation.ts:140-153` (fire-and-forget). That's the recovery substrate; we just don't currently re-insert from it.

Folding reconcile *into* the transaction (the audit's first suggestion) is the cleanest model in theory but expensive in practice: `transaction-manager.ts` blocks deletes on every report child table via `REPORT_TABLE_BLOCKLIST`, and the per-step tripwire would need wiring for IDs that change shape across the run. The **second** suggestion — keep reconcile separate, but make it auto-recoverable on transaction failure — is a much smaller change and reuses the audit log we already write.

### Fix

Two-part change. The first part covers the atomic sync path (where it matters most). The second part covers `InspectionForm`'s manual-save mirror.

**Part 1 — Auto-restore reconciled deletions when the transaction fails (`atomic-sync-manager.ts`)**

In all three `syncXAtomic` functions, the existing `executeTransaction(steps)` call is followed by a `if (!result.success)` branch that returns failure. Extend that branch to restore the rows reconcile just deleted, by re-inserting `reconcileResult` row data we already have in memory.

Concretely, change the reconcile block to **return** the deleted rows (it already does — `ReconcileResult.deletedRows` exists in `sync-reconciliation.ts`) and capture them per-table:

```ts
// existing: const reconcileResult = await reconcileAllChildTables([...], ...);
//
// NEW: aggregate deleted rows per table for restore-on-failure.
// reconcileAllChildTables already returns blocked/blockedTables; extend it to
// also return per-table deletedRows (trivial — internally each call yields
// { table, result: { deletedRows, ... } }; expose it on ReconcileAllResult).
type ReconciledTableDelete = { table: string; rows: any[] };
const reconciledDeletes: ReconciledTableDelete[] = reconcileResult.deletedByTable; // new field
```

Then around the existing `executeTransaction` in each atomic sync path:

```ts
const txResult = await executeTransaction(steps, { signal });

if (!txResult.success) {
  // C4: rollback couldn't undo the pre-transaction reconcile deletes.
  // Re-insert the rows we deleted so the user's data isn't permanently lost.
  await restoreReconciledDeletions(reconciledDeletes, parentId);
  return { success: false, error: txResult.error };
}
```

New helper, colocated in `sync-reconciliation.ts`:

```ts
export async function restoreReconciledDeletions(
  deletes: ReconciledTableDelete[],
  parentId: string,
): Promise<{ restored: number; failed: number }> {
  let restored = 0, failed = 0;
  for (const { table, rows } of deletes) {
    if (!rows.length) continue;
    try {
      // Re-insert in batches of 50 (matches existing audit batch size).
      for (let i = 0; i < rows.length; i += 50) {
        const { error } = await (supabase as any).from(table).insert(rows.slice(i, i + 50));
        if (error) throw error;
      }
      restored += rows.length;
    } catch (e) {
      console.error('[C4] Failed to restore reconciled rows', { table, parentId, error: e });
      failed += rows.length;
    }
  }
  return { restored, failed };
}
```

If `failed > 0`, surface a high-priority sync notification ("Sync failed and N child rows could not be auto-restored. Open Sync Diagnostics → Recover from server snapshot") and leave the rows in `report_deleted_items` for the existing `DeletedRecordsRecovery` admin tool, which already reads from that table.

Required tweak to `sync-reconciliation.ts`:

- Extend `ReconcileAllResult` with `deletedByTable: Array<{ table: string; rows: any[] }>` (the data is already collected internally — currently dropped after summing `totalDeleted`).

**Part 2 — Apply the same wrap to `InspectionForm`'s manual save (`InspectionForm.tsx:1718-1733`)**

Wrap the existing call:

```ts
let reconciledDeletes: ReconciledTableDelete[] = [];
if (user) {
  const r = await reconcileAllChildTables([...], id!, 'inspection', user.id);
  reconciledDeletes = r.deletedByTable;
}

try {
  await Promise.all(parallelOperations);
} catch (err) {
  await restoreReconciledDeletions(reconciledDeletes, id!);
  throw err;
}
```

Same shape for `TrainingForm.tsx:854` and `DailyAssessmentForm.tsx:864` to keep parity.

### Why this works

- `report_deleted_items` rows we already write give us a server-side audit trail; this change adds an **immediate auto-restore** so the audit becomes a fallback, not the only recovery path.
- `deletedRows` is already in memory at the point of failure — no extra fetch round trip.
- Keeps reconcile outside the transaction (avoids the `REPORT_TABLE_BLOCKLIST` rewrite in `transaction-manager.ts`).
- Idempotent: if restore partially succeeds, `report_deleted_items` still has the originals; the admin recovery tool can finish the job.

### Out of scope

- Folding reconcile fully into the transaction (the audit's first option). Bigger refactor; reconsider if C4's auto-restore proves insufficient.
- The `empty_local_guard` interaction (C2 already handles empty-local skip + user prompt).
- Restoring child *upsert* rows on rollback (already handled by `rollbackTransaction`'s `step.rollbackData`).
- Photos table (different lifecycle).

### Risk

Low. New code path runs only on transaction failure (today's outcome there is silent data loss). Worst case the re-insert itself fails — the rows are still in `report_deleted_items` and surfaced via the existing admin recovery UI plus a new high-priority sync notification.

### Verification

- `npx tsc --noEmit`.
- DEV scenario A (the bug): pick an inspection with 5 server systems. Locally remove 2 systems and stamp `user_cleared_at` so reconcile proceeds. In `executeTransaction`, force a throw (e.g., temporarily reject the second `upsert` call). Trigger sync. Expect:
  - Console: `[Reconcile] inspection_systems: 2 rows to delete...`, then transaction failure, then `[C4] Restoring 2 reconciled deletions for inspection ...`.
  - Server `inspection_systems` for that inspection contains all 5 rows again.
  - `report_deleted_items` has the 2 audit rows (unchanged).
- DEV scenario B (happy path): no forced throw. Confirm no `[C4]` log line, no extra inserts, behavior unchanged.
- DEV scenario C (manual save mid-network-drop): in `InspectionForm`, delete 1 zipline, hit Save, kill network in DevTools after the reconcile log fires but before the upsert log. Re-enable network. Expect the deleted zipline to reappear on the server within seconds (auto-restore) and the local save to remain dirty for the next sync cycle.
- Repeat A & C for trainings and daily assessments.

