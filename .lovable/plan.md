

## S32 — Serialize per-item child reads in `syncInspectionAtomic` / `syncTrainingAtomic` / `syncDailyAssessmentAtomic`

### Problem

`getUnsyncedCounts` (offline-storage.ts L2817–2820) was deliberately serialized to reduce Safari IDB lock contention, but the per-item sync entry points still fan out 6 parallel `getRelatedDataOfflineWithStatus` reads at the top of every item:

- `atomic-sync-manager.ts` L209–223 — inspection: 6 parallel reads (parent + 5 children)
- L1192 — training: 6 parallel reads (parent + 5 children, parent fetched separately above)
- L1996 — assessment: 6 parallel reads (parent + 5 children)

When the outer loop iterates N unsynced items, that's `6 × N` concurrent IDB reads on the same DB, which on Safari/iOS is exactly the contention pattern that triggers the `withIDBTimeout` fallbacks the read-with-status helpers exist to detect — meaning we sometimes mark a perfectly-good local read as "failed" and abort the sync defensively, just because we issued too many reads at once.

### Fix

**Serialize the 6 reads inside each `*Atomic` entry point.** Replace the `Promise.all([...])` with 6 sequential `await`s. Same data, same return shape, same error semantics — but only one outstanding IDB request per item at a time. The outer loop already serializes items (one item per iteration), so the total in-flight read count drops from `6` to `1`.

We keep `getRelatedDataOfflineWithStatus` unchanged (it still wraps each call in `withIDBTimeout` and reports `readSucceeded` per-call), so the existing "abort sync if a child read truly failed" guard continues to work.

### Files

**`src/lib/atomic-sync-manager.ts`** — three call sites, each reshaped from `const [a, b, c, d, e, f] = await Promise.all([...])` to sequential `await` statements:

1. **L209–223** (`syncInspectionAtomic`): sequential reads of inspection, systems, ziplines, equipment, standards, summary.
2. **L1192** (`syncTrainingAtomic`): sequential reads of delivery_approaches, operating_systems, immediate_attention, verifiable_items, systems_in_place, summary.
3. **L1996** (`syncDailyAssessmentAtomic`): sequential reads of beginning_of_day, end_of_day, operating_systems, equipment, structure, environment.

The S2 design comment on the inspection block ("kick off child reads in parallel since children are keyed by inspectionId we already have") is now stale — replace it with a one-line note explaining the S32 sequencing decision.

### Out of scope

- The other `Promise.all` sites in this file (rollback fetches L566/L1431/L2229, recovery saves L596/L1464/L2262, ID-rebind saves L821/L1683): those are either Postgres reads (no IDB lock) or executed once per affected item, not in the hot per-item read path.
- The dashboard-cache parallel read at L380/L1283/L2081: that runs only on `getOfflineInspection` for fallback display, well outside the sync hot path.
- Changing `getRelatedDataOfflineWithStatus` itself.

### Risk

Negligible. Sequential awaits are strictly less concurrent than `Promise.all`; correctness is identical. Latency per-item rises from `max(6 reads)` to `sum(6 reads)`, but on Safari the parallel version was already serializing under the hood at the IDB layer plus paying contention overhead — net wall-clock should be flat or better. Other browsers see a small per-item slowdown (~few ms × 6) that is invisible against network round-trip time.

### Verification

- `npx tsc --noEmit`.
- Manual: queue 5+ unsynced inspections, sync, confirm all complete and `withIDBTimeout` fallback warnings disappear from the console (vs. occasional appearance today).
- Manual: same drill on iOS Safari where the contention is most visible.
- Regression: existing sync tests (`src/lib/__tests__/sync-hardening.test.ts`) still pass.

