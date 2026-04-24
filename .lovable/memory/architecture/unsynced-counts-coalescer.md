---
name: unsynced counts coalescer
description: useAutoSync.updateUnsyncedCounts has 3-layer throttling (in-flight dedup, 1.5s min-gap, 5s freshness); getUnsynced* filter ownership-first then session-quarantine
type: architecture
---
**Throttling layers** in `useAutoSync.updateUnsyncedCounts` (call with `{force:true}` to bypass freshness):
1. In-flight dedup — share the existing promise.
2. 1.5s min-gap between runs.
3. 5s freshness short-circuit (skipped when `force:true`).

**`getUnsynced{Inspections,Trainings,DailyAssessments}` filter pipeline** (in order):
1. `isNotQuarantined` — drop IDB-quarantined rows (`_remote_deleted_at` set).
2. **Ownership filter** (S40 Fix A) — `inspector_id === userId` OR `id.startsWith('temp-')`. Must run BEFORE drift check, otherwise cross-user records on a shared device cause hot loops of IDB scans (~295 timeouts/cycle observed).
3. **Session-quarantine filter** (S41 Fix E) — drop `sync-quarantine.isQuarantined(id)`. Without this, records that failed 3× stay in the user-facing pending count forever (until end of UTC day or session end), showing a stuck "1 pending" badge for items the sync pipeline has already given up on.
4. Drift / dirty check — `dirty===true` OR `!synced_at` OR `isUpdatedAheadOfSync(updatedMs, syncedMs)`.

The session-quarantined records are surfaced separately in `SyncPulse` Sync Terminal as `QUARANTINED N — Retry Now`.
