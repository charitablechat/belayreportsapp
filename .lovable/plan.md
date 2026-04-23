## M4. Make the suspicious_empty_guard actually block when IDB reads silently failed

### The real gap

The guard at three sites in `src/lib/atomic-sync-manager.ts` (inspections ~line 815, trainings ~1737, assessments ~2540) was *intended* to catch the case where a record is older than 5 minutes, was edited (>60s after creation), and locally appears to have zero child rows — the comment says this "likely means IndexedDB reads failed silently." But every branch inside the guard just calls `syncLog.log(...)` and falls through. There is no `return { skipped: true }` path. So when IDB reads truly do fail (circuit breaker open, timeout, store missing), the sync proceeds with an empty payload and overwrites the server's canonical state.

We now have the exact signal needed to fix this properly: `idbReadFlags` / `trainingIdbReadFlags` / `assessmentIdbReadFlags` (introduced by the P2 `{ items, readSucceeded }` contract) already live in the same scope as the guard. If **every** child read returned `readSucceeded: false` AND local appears empty AND the record is old & edited, that is the silent-IDB-failure fingerprint — we should refuse to sync.

### Fix

At each of the three guard sites, replace the no-op log-only branch with a real skip that fires only when IDB reads collectively failed. Genuine blank forms (reads succeeded, payload truly empty) continue to sync normally.

**Inspections (`~line 815`)** — `idbReadFlags` already exists. If `localIsCompletelyEmpty && wasEdited && ageMinutes > 5` AND every flag in `idbReadFlags` is `false`, return:
```ts
return { success: false, skipped: true, reason: 'suspicious_empty_idb_read_failure' };
```
Otherwise keep the existing allow-through logs (genuinely blank, or reads succeeded so trust the empty payload).

**Trainings (`~line 1737`)** — same logic against `trainingIdbReadFlags`.

**Assessments (`~line 2540`)** — same logic against `assessmentIdbReadFlags`.

In all three: the skip must happen *before* the upsert/reconcile step that follows, so the parent record stays unsynced and will retry on the next cycle when IDB has recovered.

### Why "all flags false" rather than "any flag false"

A single failed read is already handled by `reconcileChildTable`'s `expectedNonEmpty` guard (P4) — that table's reconcile is blocked, the parent sync rolls back via `blocked: true`, and the success toast is suppressed by H12. The case this guard uniquely catches is the **circuit-breaker-open** scenario where *every* read returns the empty fallback and no per-table guard can tell the difference between "store legitimately empty" and "store unreadable." Requiring all flags to be `false` is the conservative trigger that matches that specific fingerprint without producing false positives for legitimately blank records that happen to have one transient read miss.

### Caller behavior

The `success: false, skipped: true` return shape is already understood by `syncAllInspectionsAtomic` / `syncAllTrainingsAtomic` / `syncAllAssessmentsAtomic` — `skipped: true` increments neither `success` nor `failed` counts, so the H12 toast logic stays clean (no false partial-failure warning, no false success). The record simply remains unsynced and re-enters the queue next cycle.

### Files

- `src/lib/atomic-sync-manager.ts` — three small edits, one per guard site (~10 lines changed each).

### Verification

- `npx tsc --noEmit`
- Existing `src/lib/__tests__/sync-hardening.test.ts` Priority 2 / 4 tests continue to pass.
- Manual trace: with circuit breaker forced open (e.g., temporarily throw in `checkIndexedDBHealth`), edit an existing report, wait >5 min, trigger sync — confirm console shows `suspicious_empty_idb_read_failure` skip and the server row is **not** overwritten with empty children.
