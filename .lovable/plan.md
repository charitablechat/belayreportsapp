

## S11 + S12: Surface IDB read failures + Realtime full-package refetch

Two surgical fixes to close the remaining sync-visibility gaps.

---

### S11 — Make IDB read failures distinguishable from "no unsynced items"

**Root cause.** `withIndexedDBErrorBoundary` in `offline-storage.ts` (~953–1001 and the assessment/training siblings) catches every error — including the internal 10 s timeout — and returns `[]`. Callers like `getUnsyncedInspections`, `getUnsyncedTrainings`, `getUnsyncedDailyAssessments` then return that `[]` straight to `syncAllInspectionsAtomic` / `useAutoSync.updateUnsyncedCounts`. The only failure path that surfaces is the **outer** 15 s wrapper in `atomic-sync-manager.ts` (~759–791), which special-cases `'IndexedDB timeout'` and returns `{ total: -1 }`. Anything the boundary swallows looks identical to "user is fully synced": the badge reads 0, no banner, no retry.

**Fix.** Make IDB read failures a first-class signal end-to-end.

**1. `withIndexedDBErrorBoundary` — return a tagged failure, not `[]`.**

Replace the silent `return fallback` path with a sentinel:

```ts
// src/lib/offline-storage.ts
export const IDB_READ_FAILED = Symbol.for('rw.idb-read-failed');
export type IdbReadFailure = { __idbReadFailed: typeof IDB_READ_FAILED; error: string };

export function isIdbReadFailure(v: unknown): v is IdbReadFailure {
  return !!v && typeof v === 'object' && (v as any).__idbReadFailed === IDB_READ_FAILED;
}

async function withIndexedDBErrorBoundary<T>(
  op: () => Promise<T>,
  context: string,
): Promise<T | IdbReadFailure> {
  try {
    return await op();
  } catch (err) {
    console.error(`[IDB] ${context} failed:`, err);
    return { __idbReadFailed: IDB_READ_FAILED, error: (err as Error)?.message || String(err) };
  }
}
```

The previous `fallback` parameter goes away — callers must explicitly handle the failure case. This is the whole point: silent fallback was the bug.

**2. Update read helpers to propagate the sentinel.**

`getUnsyncedInspections`, `getUnsyncedTrainings`, `getUnsyncedDailyAssessments`, `getUnuploadedPhotos`, and any other reader currently using the boundary now have return type `T[] | IdbReadFailure`. Internal callers that wrap multiple reads (e.g. queue-status helpers) check `isIdbReadFailure` and short-circuit upward.

**3. Caller updates.**

- `atomic-sync-manager.ts` (`syncAllInspectionsAtomic` ~759–791 + training/assessment siblings): replace the string-match `'IndexedDB timeout'` check with `isIdbReadFailure(unsynced)`. Return `{ total: -1, errors: [{ id: 'idb_read_failure', error: result.error }] }`. The outer 15 s `Promise.race` timeout stays, but its fallback now also returns the same shape. One uniform failure signal upward.
- `useAutoSync.updateUnsyncedCounts`: when any of the three reads is an `IdbReadFailure`, do NOT zero the badge. Keep the previous count, set a new `idbReadError` flag in the hook's state, and surface it via `PWAContextType.syncError` (already plumbed through the provider). The badge keeps showing the last-known count and the existing error UI lights up.
- `useUnsyncedPhotos`: same pattern — preserve the last count, expose an error.

**4. UI surface.** No new component. The error already routes through `PWAContextType.syncError`, which `SyncStatusIndicator.tsx` and `BackgroundSyncStatus.tsx` consume. We just need to make sure the message says something useful: `"Local data unreadable — refreshing may help"`.

---

### S12 — Realtime parent events trigger full-package refetch

**Root cause.** `handleRemoteChange` in `useAutoSync.tsx` (~573–611) only listens on the three parent tables (`inspections`, `trainings`, `daily_assessments`). Child tables (`inspection_systems`, `inspection_ziplines`, `inspection_equipment`, `inspection_standards`, `inspection_summary`, `inspection_photos`, the training and assessment children) emit no events to the client. Cross-device editing of a child row is invisible until the next manual refetch — and worse, when the parent's `updated_at` bumps for an unrelated reason, the local IDB parent gets refreshed but the children stay stale.

**Fix.** When a parent-row Realtime event survives `shouldPreserveLocalRecord`, schedule a full-package refetch of THAT record (parent + all its children) from the server, then write the package atomically to IDB. No new subscriptions — keeps the realtime channel narrow.

**1. New helper `refetchInspectionPackage(id)` (and training/assessment equivalents) in `atomic-sync-manager.ts`.** Single round-trip that pulls parent + all child collections in parallel, then calls the existing `saveInspectionOffline` / child-store overwrites in one transaction. Wrap each in self-write registration so we don't trigger our own Realtime echo (the S6 `selfWriteIds` set handles this).

**2. Wire into `handleRemoteChange`.** After the existing `shouldPreserveLocalRecord` check passes:

```ts
// useAutoSync.tsx, handleRemoteChange
if (payload.eventType !== 'DELETE') {
  // Existing parent-row preservation logic stays.
  // NEW: schedule a debounced full-package refetch.
  scheduleFullRefetch(payload.table, payload.new.id);
}
```

`scheduleFullRefetch` is a per-id debouncer (300 ms) that coalesces rapid-fire parent updates from the same record into a single refetch. Implementation: `Map<id, timeoutId>` cleared on flush. Cancels itself on unmount.

**3. Concurrency guard.** If a sync cycle is in flight for the same record (`syncInProgressRef` + per-record locks already exist), defer the refetch until it completes — otherwise we'd race with our own write and possibly clobber an in-flight merge.

**4. Failure handling.** Refetch errors are non-fatal: log, leave local state alone, let the next auto-sync cycle reconcile. Tied into S11 — if the refetch itself fails because IDB is unreadable, surface via the same `syncError` path.

**Out of scope:** Subscribing to child tables directly. That path scales poorly (one subscription per child table per record visible to the user) and the server already has the authoritative state — a single round-trip refetch is simpler and uses the auth/RLS we already trust.

---

### Files

- `src/lib/offline-storage.ts` — replace `withIndexedDBErrorBoundary` body, export `isIdbReadFailure` + sentinel, update read-helper return types.
- `src/lib/atomic-sync-manager.ts` — adopt `isIdbReadFailure` in three sync entry points (~759–791 + siblings); add `refetchInspectionPackage` + training/assessment equivalents.
- `src/hooks/useAutoSync.tsx` — update `updateUnsyncedCounts` to preserve last-known count on IDB failure and set `syncError`; add `scheduleFullRefetch` + per-id debounce in `handleRemoteChange` (~573–611).
- `src/hooks/useUnsyncedPhotos.tsx` — same preserve-last-count pattern for photo reads.
- `src/components/pwa/PWAProvider.tsx` — no schema change needed; `syncError` is already in `PWAContextType`. Verify the path through.

### Out of scope

- Migrating every IDB consumer outside the sync surface to the new sentinel (logo cache, equipment-type cache, etc.) — those don't gate the unsynced badge so silent fallback there is acceptable for now. Tagged for a follow-up sweep.
- Subscribing to child tables individually — see S12 reasoning.
- Surfacing per-record refetch state in admin diagnostics.

### Risk

Low. S11's return-type change is contained to the read-helper surface; TypeScript will flag every consumer that needs an `isIdbReadFailure` guard, so the migration is mechanical and verified by compilation. Worst case: a missed call-site keeps today's behavior (silent `[]`) until we update it. S12 adds one debounced refetch per parent event; even on a chatty channel the 300 ms coalesce caps it at ~3 refetches/second/record, well below the existing sync floor. Self-write suppression (S6) prevents echo loops.

