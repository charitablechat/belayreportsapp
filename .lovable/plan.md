## H4 — Close the silent-overwrite window in cross-device conflict detection

### Finding

`src/lib/atomic-sync-manager.ts` line 197: `CONFLICT_THRESHOLD_MS = 30_000` (already raised from 5s; the report's "5s" was outdated, but the failure mode is real and worse than described).

The S16 field-merge path (lines 610–665 inspections, 1567–1590 trainings, 2367–2391 assessments) is **only entered** when `timeDiff > 30_000 && remoteUpdated > localUpdated`. Below that window the merge is **skipped entirely** and the local row upserts straight over the server row, silently dropping any remote field the local device hasn't seen.

Concrete failure: User B saves inspection X at 10:00:00. User A's autosave at 10:00:25 carries A's older `field_timestamps` for fields A didn't touch. `timeDiff = 25s < 30s`, merge is skipped, A's upsert lands and clobbers B's edits on every field A's row mentions — even fields A never touched, because the upsert ships the whole row.

The threshold was put there to filter clock skew between devices, but it's the wrong signal. The correct signal — "did remote actually change since *our* last sync?" — is already computed for inspections (`remoteUpdatedAfterOurSync`) but only consumed *inside* the `timeDiff` gate, and isn't computed at all for trainings/assessments. The `mergeRecordFields` function itself is idempotent and safe to run on identical inputs (verified in `src/lib/field-merge.ts` lines 73–127): same field timestamps → local wins by strict `>`; unaffected fields stay equal on both sides; no spurious churn.

The right fix is to drop the brittle time-window gate and merge whenever the remote *could* have changed since our last sync.

### Fix

1. **Remove `CONFLICT_THRESHOLD_MS` from the merge gate** in all three sync functions (inspections, trainings, daily assessments). Replace with a single "remote updated after our last sync" check:

   ```ts
   const remoteUpdated = Date.parse(recordStatus.updated_at!);
   const localSyncedAt = inspection.synced_at ? Date.parse(inspection.synced_at) : 0;
   // Merge whenever remote changed after our last successful sync — we may
   // have missed remote field edits regardless of how recent the local edit is.
   const remoteChangedSinceOurSync = !localSyncedAt || remoteUpdated > localSyncedAt + SYNC_DRIFT_TOLERANCE_MS;
   if (remoteChangedSinceOurSync) {
     // fetch remoteRow, mergeRecordFields(local, remote, TRACKED_FIELDS.X), Object.assign
   }
   ```

   - `SYNC_DRIFT_TOLERANCE_MS` (already exported from `src/lib/local-data-guards.ts` at 30s) absorbs benign clock skew between server and client without re-introducing a 30s blind spot — we still merge whenever remote drifted *outside* tolerance, and skip only when it's plausibly the same logical version we already synced.
   - First-time sync (no `synced_at`) always merges — correct.
   - We no longer require `remoteUpdated > localUpdated`. If local is newer, the per-field merge still picks local for every field it changed; but it preserves remote for fields only the other device touched.

2. **Apply identically to all three branches** (inspections at 610–665, trainings at 1567–1590, assessments at 2367–2391). Trainings and assessments currently lack the `isAlreadySynced` / `remoteUpdatedAfterOurSync` plumbing — this fix unifies them.

3. **Keep the audit insert** (`sync_conflicts.insert(... resolved: true)`) only on the inspections branch, mirroring today's behavior. No new UI surface — merges remain silent (consistent with the existing "silent collaborative merge" memory).

4. **Constant cleanup.** `CONFLICT_THRESHOLD_MS` becomes unused — remove the declaration and its doc comment to avoid future drift between sites that re-import it.

### Why a content-hash compare isn't needed

The original suggestion ("compare content hashes before declaring a conflict") would only matter if the merge itself were destructive. It isn't: `mergeRecordFields` is a per-field max-timestamp picker, deterministic and idempotent. Hashing parent rows would add CPU cost on every sync without changing the outcome. Skip.

### Files changed

- **`src/lib/atomic-sync-manager.ts`**:
  - Remove `CONFLICT_THRESHOLD_MS` constant + doc comment (~lines 192–197).
  - Replace the merge gate in `syncInspectionAtomic` (~lines 610–664) with the `remoteChangedSinceOurSync` check.
  - Replace the merge gate in `syncTrainingAtomic` (~lines 1567–1590) — same pattern, using `training.synced_at`.
  - Replace the merge gate in `syncDailyAssessmentAtomic` (~lines 2367–2391) — same pattern, using `assessment.synced_at`.
  - Add `import { SYNC_DRIFT_TOLERANCE_MS } from './local-data-guards'` if not already present.

No other files affected. `mergeRecordFields`, `field_timestamps`, and the `sync_conflicts` table remain unchanged.

### Verification

- DEV scenario A (the bug): Device A and Device B both have inspection X loaded. B edits the `notes` field and saves at T=0. A edits `location` and autosaves at T=5s (well inside the old 30s window). Expect: server ends with B's `notes` AND A's `location`. Today: server ends with A's row entirely, B's `notes` lost.
- DEV scenario B (clock skew): two devices with synced clocks, neither has edited the row, but server-side trigger jitter pushes `updated_at` 2s past `synced_at`. Expect: no merge fetch (within 30s drift tolerance), no spurious round-trip.
- DEV scenario C (idempotent merge): same device syncs twice in a row with no remote changes. Expect: second sync sees `remoteUpdated <= synced_at + 30s`, skips merge fetch, normal upsert proceeds.
- DEV scenario D (training + daily assessment): repeat A for both. Today these branches are even worse (no `isAlreadySynced` check at all) — fix lifts them to parity.
- DEV scenario E (first-time sync): brand-new local record, no `synced_at`. Expect: merge fetch runs once (harmless — server returns nothing for a brand-new id), then upsert proceeds.
- Regression: `npx tsc --noEmit`. Existing `field-merge.test.ts` continues to pass (function unchanged). Existing `sync_conflicts` audit insert behavior unchanged for the inspection branch.

### Risk

Low. The change is **strictly more conservative**: today the merge is skipped in a 30s window where data loss occurs; after the fix the merge runs whenever it could matter. The merge itself is deterministic and proven (it's been the field-merge engine since S16). Worst-case bug: an extra `select * from inspections where id = X` round-trip per sync when clocks are skewed — negligible cost, no correctness impact.

### Out of scope

- Tightening `SYNC_DRIFT_TOLERANCE_MS` itself (used by many other call sites; would need its own analysis).
- Surfacing merged conflicts in the UI (silent merge is the documented design — see `mem://features/silent-conflict-resolution-v7`).
- Hashing for child-row reconciliation (different code path, different problem).
