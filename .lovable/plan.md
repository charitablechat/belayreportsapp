

## S28 — Add retry ceiling + dead-letter for queued soft-deletes

### Problem

`processQueuedSoftDeletes` retries failed soft-delete ops every sync cycle forever. A permanent failure (RLS denial, deleted record, schema mismatch) burns network and log noise indefinitely with no operator visibility.

### Design

**Retry counter on the queue entry.** Add an `attempts: number` field (and `lastError: string`, `lastAttemptAt: string`) to queued op records as they pass through the processor. The IDB stores already accept arbitrary fields on op rows (`getQueuedOperations` returns the raw object), so we can persist these without a schema migration — we just `put` the mutated op back via the existing `removeQueuedOperation` + re-add pattern, OR add a small `updateQueuedOperation` helper.

**Threshold.** `MAX_SOFT_DELETE_ATTEMPTS = 5`. After the 5th consecutive failure, the op is moved to a dead-letter store and removed from the active queue.

**Dead-letter store.** New IDB object store `dead_letter_soft_deletes` (created lazily; bumped DB version handled via existing `idb-migration-safety` snapshot path). Each entry: `{ id, originalOp, table, recordId, attempts, firstFailedAt, lastError, deadLetteredAt }`. No automatic retry — operator-visible only.

**Processor changes** (`src/lib/queued-soft-delete-processor.ts`):
- On each iteration, before the supabase call, read `op.attempts ?? 0`.
- On supabase error: increment attempts, write `lastError` + `lastAttemptAt` back to the op. If `attempts >= 5`, push to `dead_letter_soft_deletes` and `removeQueuedOperation(op.id!)`. Otherwise leave in queue for next cycle.
- On success: existing remove path unchanged.
- Apply identically to all three queues (inspections, assessments, trainings).

**Helper additions** (`src/lib/offline-storage.ts`):
- `updateQueuedOperation(id, patch)` / `updateQueuedAssessmentOperation` / `updateQueuedTrainingOperation` — small `put`-based helpers.
- `addToDeadLetterSoftDeletes(entry)` + `getDeadLetterSoftDeletes()` + `removeDeadLetterSoftDelete(id)` for the new store.
- Bump IDB version; add the new store in the `onupgradeneeded` path. Pre-migration snapshot logic already covers new-store additions safely.

**Result reporting.** Extend `SoftDeleteProcessorResult` with `deadLettered: number` so the auto-sync loop can surface a one-time toast like "3 deletions failed permanently — see diagnostics."

**Operator visibility (minimal).** Add a small section to `src/components/pwa/SyncDiagnosticsSheet.tsx` listing dead-lettered entries with table/recordId/lastError and a "Retry once" / "Discard" button per entry. Retry pushes the op back into the active queue with `attempts: 0`; discard removes from the dead-letter store.

### Files

- `src/lib/queued-soft-delete-processor.ts` — attempt counting, dead-letter on threshold, return `deadLettered` count.
- `src/lib/offline-storage.ts` — new `dead_letter_soft_deletes` store + IDB version bump + 6 new helpers.
- `src/components/pwa/SyncDiagnosticsSheet.tsx` — small "Failed deletions" panel with retry/discard.
- `src/hooks/useAutoSync.tsx` (or wherever the processor result is consumed) — surface a toast when `deadLettered > 0`.

### Out of scope

- Auto-retry of dead-lettered entries on a schedule.
- Server-side audit log of dead-lettered operations.
- Backfilling attempt counts onto already-queued ops (they start at 0 on first run after deploy, which is correct behavior).

### Risk

Low. New store + version bump is the only schema change; covered by the existing pre-migration snapshot system. Failure of the dead-letter write itself falls back to leaving the op in the queue (current behavior), so we never lose data.

### Verification

- `npx tsc --noEmit`.
- Unit: extend an existing processor test to simulate 5 consecutive failures and assert the op moves to the dead-letter store with `attempts: 5`.
- Manual: toggle off RLS update permission for one record, run sync 5 times, confirm the entry disappears from the active queue and appears in the diagnostics sheet.

