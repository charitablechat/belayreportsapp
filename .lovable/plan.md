

## C8 — Fix `syncTrainingAtomic` / `syncDailyAssessmentAtomic` reading children under stale ID

### Finding

In `src/lib/atomic-sync-manager.ts`, `syncTrainingAtomic` (~lines 1028–1067) and `syncDailyAssessmentAtomic` (analogous block) compute:

```ts
const fetchId = trainingIdMapping ? trainingIdMapping.oldId : trainingId;
```

…then read all child stores at `fetchId` (oldId), and only after the read remap `child.training_id = newId` in memory.

This was correct on the **first** sync of a temp-id training. But the cleanup block at ~lines 1448–1472 already rewrites IDB children to live under `newId` once the temp-id mapping resolves. On every **subsequent** sync of the same training:

- `trainingIdMapping` is still present in the in-flight call (constructed from the parent's id swap at sync entry), so `fetchId = oldId`.
- IDB children no longer exist at `oldId` — they were relinked to `newId` by the prior cleanup.
- Reads return `[]` with `readSucceeded: true`.
- `expectedNonEmpty` is computed from that empty array → `false`.
- The reconcile path treats the server's populated state as orphaned and either preserves (P4 guard) or, worst case, deletes server children that the user still has locally under `newId`.
- All future edits made under `newId` ship to nowhere, because we keep reading `oldId`.

The inspection path (`syncInspectionAtomic`) does not have this bug because it derives `fetchId` from the post-mapping id. Trainings and daily assessments diverged.

### Fix

**One file: `src/lib/atomic-sync-manager.ts`.** Two analogous edits.

For both `syncTrainingAtomic` and `syncDailyAssessmentAtomic`:

1. **Always read at the post-migration id.** Replace:
   ```ts
   const fetchId = trainingIdMapping ? trainingIdMapping.oldId : trainingId;
   ```
   with:
   ```ts
   // C8: Always read children at the canonical (post-migration) id.
   // The temp-id cleanup block below is the single source of truth that
   // bridges oldId → newId in IDB; reads must follow that contract or
   // they will silently return [] on every sync after the first.
   const fetchId = trainingId;
   ```

2. **Drop the now-redundant in-memory remap.** Remove the `if (trainingIdMapping) { rawDeliveryApproaches.forEach(...) ...; rawOperatingSystems.forEach(...) ...; ... }` block immediately following the reads — children are already keyed under `trainingId`, so no rewrite is needed.

3. **Belt-and-braces invariant.** Right before constructing the upsert transaction steps, add:
   ```ts
   // C8: Invariant — by this point the parent id is canonical and all
   // child reads must have used the same id. If a future refactor
   // reintroduces a divergence, fail loudly in DEV instead of silently
   // shipping an empty children payload.
   if (import.meta.env.DEV && fetchId !== trainingId) {
     console.error('[C8] fetchId/trainingId divergence detected', { fetchId, trainingId });
   }
   ```
   (Identical invariant in the daily assessment path with the assessment id.)

4. **Keep the cleanup block at ~lines 1448–1472 unchanged.** It remains the single bridge. It runs *after* a successful first sync and rewrites any leftover oldId-keyed IDB children to newId, so by the time this function is re-entered, IDB is already canonical.

5. **Sanity-check the temp-id cleanup runs before any second sync attempt.** It already does — it's awaited inside the same atomic call that produced the `newId`. No change needed; just confirmed.

### Why this is safe

- **First sync of a temp-id training/assessment:** the temp-id-to-real-uuid swap on the *parent* happens at the top of `syncTrainingAtomic` (the existing dedup/temp-id logic, unchanged). After that swap, `trainingId` is the real UUID. Children in IDB are still keyed under the temp id at this exact moment — **but** the existing cleanup block at 1448–1472 is the place that rewrites them. We need to make sure children are read *after* that rewrite, or we need a different bridge for the very first sync.

   Looking at the actual flow: on first sync, the parent id swap happens, then we read children. At this instant children are still under the temp id. So `fetchId = trainingId` (real id) would read empty on the first sync.

   **Resolution:** restructure slightly. The temp-id cleanup that rewrites children from oldId → newId in IDB must run **before** the children read on first sync, not after the upsert. Concretely:

   - Move the IDB child-rewrite portion of the 1448–1472 cleanup to *immediately after* the parent id swap and *before* the children reads.
   - Keep the rest of that block (e.g., audit / mapping store cleanup) where it is.

   With that, the contract becomes: by the time we read children, IDB is canonical under `trainingId` whether this is the first or Nth sync. `fetchId = trainingId` works for both.

   If moving the rewrite is more invasive than warranted, the safer and smaller alternative is to keep `fetchId` derivation but compute it post-rewrite — same end state, fewer moved lines. We'll prefer the smaller diff: add a new `await rewriteChildrenIdbFromOldToNew(trainingIdMapping)` call in this function (extracted from the existing cleanup block, idempotent) right after the parent id swap, then set `fetchId = trainingId`.

- **Subsequent syncs:** `trainingIdMapping` may or may not be present; `fetchId = trainingId` always points at the canonical id; reads return the user's actual children; reconcile sees a real `localCount`; `expectedNonEmpty` reflects reality; P4 guards behave correctly.

- **No interaction with C1–C7.** The P4 guard added in C2/the reconcile-blocked machinery still protects against true read failures (`readSucceeded: false`); this fix just stops generating fake "local is empty" reads in the first place.

### Out of scope

- The inspection path. It already derives `fetchId` correctly. No changes there.
- Reworking the temp-id mapping store schema. Idempotent rewrite helper is enough.
- Backfill for trainings/assessments that already silently lost child edits on a previous sync. If the user wants a one-shot recovery script (compare server children to local under newId, push the union), that's a follow-up.

### Risk

Small. Two functions in one file. The behavior change is "child reads happen at the canonical id" — the same id every other downstream step (reconcile, upsert, mapping cleanup) already uses. Worst case if the rewrite-helper extraction has a bug: first sync of a brand-new temp-id training reads empty children → reconcile P4 guard blocks the destructive deletion → next sync (after cleanup) succeeds. Strictly safer than today.

### Verification

- `npx tsc --noEmit`.
- DEV scenario A (the bug): create a training offline (temp id), add 3 delivery approaches + 2 operating systems, go online, let it sync. Confirm parent + children land on the server. Edit one delivery approach, save, trigger another sync. Expect: the edit reaches the server. Today: it doesn't.
- DEV scenario B (subsequent sync, no edits): nothing changed locally. Trigger sync. Expect: no spurious child upserts, no reconcile-blocked log, no `[C8]` divergence warning.
- DEV scenario C (first sync end-to-end): brand-new offline training with 5 children, single sync cycle. Expect: parent + all 5 children on server, IDB children rekeyed to newId, no warnings.
- DEV scenario D (daily assessment): repeat A and C for `syncDailyAssessmentAtomic`.
- Inspection regression check: confirm `syncInspectionAtomic` is untouched and a normal inspection sync still works.

