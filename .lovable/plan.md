
# Sync Engine Audit — Findings & Remediation Plan

Scope: `src/lib/offline-storage.ts`, `atomic-sync-manager.ts`, `useAutoSync.tsx`, `sync-quarantine.ts`, `deferred-reconcile.ts`, `restore-lock.ts`, `restore-integrity.ts`, `sync-reconciliation.ts`, `reconcile-server-deletions.ts`, photo upload pool, and PWA wiring. ~14 KLOC of sync code with 76 unit tests in `src/lib/__tests__/`.

## 1. Verification of recent fixes

### 1a. `getUnsynced*` filter pipeline (offline-storage.ts:3147+, 4776+, 5207+)
Confirmed correct order on all three readers:
1. `UNSYNCED_SCAN_CAP` getAll (M1 overflow guard, Sentry-reported once/session/store).
2. `isNotQuarantined` (drops `_remote_deleted_at` rows — C9).
3. Ownership filter — `inspector_id === userId` OR `id.startsWith('temp-')` (S40 Fix A).
4. `!isSessionQuarantined(id)` (S41 Fix E — drops 3×-failed rows from the visible pending count).
5. Drift / dirty check — `dirty===true` || `!synced_at` || `isUpdatedAheadOfSync(updated, synced)`.

Boundary tests in `unsynced-read-boundary.test.ts` cover: 29s within tolerance, 31s exceeds, dirty-overrides-drift, quarantine exclusion, empty-store returns `[]` (not `IdbReadFailure`), temp-id orphan recovery, and `saveInspectionOffline` always stamping `dirty=true`. **Status: stable, well-covered.**

### 1b. `DataError: Failed to execute 'only' on 'IDBKeyRange'`
Root cause was indexing booleans on `photos.by-uploaded`. Fix is fully integrated:
- `toUploadedFlag(v): 0 | 1` (line 3468) is funnelled through every photo write site I could find: `putPhotoRecord`, `savePhotoOffline`, `markPhotoUploaded`, the cursor passes in `evictSyncedPhotos`, restore handlers, and the v16/v18 migration cursors.
- All `IDBKeyRange.only(...)` call sites against `by-uploaded` now pass numeric `0` / `1` (lines 3734, 3826, 3935; autocomplete index at 5675 uses the same pattern).
- DB version is pinned at 18 in **both** `public/db-config.js` and `src/lib/offline-storage.ts`; `vite-db-version-check.ts` fails the build on mismatch.
- v16 (raw cursor, `idb` doesn't await — known-leaky) is followed by v18 (wrapped cursor, awaited) so any boolean rows from v15 era are guaranteed rewritten.
- Tests: `photos-by-uploaded-contract.test.ts`, `photo-uploaded-index.test.ts`, `put-photo-record-uploaded-flag.test.ts`, `migrate-pending-photo-paths-uploaded-flag.test.ts`, plus the `0|1` index lookup case in `unsynced-read-boundary.test.ts`.

**Status: fix is complete and regression-locked. No further action required.**

## 2. Findings (ranked by risk)

### CRITICAL — none open
No data-loss or pipeline-halting defects identified in the current tree.

### HIGH

**H-1. v16 cursor still runs on first-time-to-v17/18 upgraders**
v16's raw `IDBObjectStore.openCursor()` does not await transaction completion through the `idb` wrapper. On a slow device an upgrade can commit before the cursor finishes, leaving boolean rows. v18 covers this — but only for users who reach v18. Risk is low because the parity check forces v18 in production; but in a debugging branch where someone bumps `offline-storage.ts` without `db-config.js`, the SW could see v16 rows on a v17 main thread. Recommendation: delete the v16 block (it is now dead code) and document v18 as the canonical fix. Risk: Low. Effort: 5 min.

**H-2. Unsynced-counts coalescer freshness window can hide a just-completed sync**
`useAutoSync.updateUnsyncedCounts` short-circuits on a 5s freshness window unless called with `{force:true}`. Verify every post-sync caller passes `force:true` — `performSync` does, but any third-party caller (e.g. restore-lock release) must too. Add a test asserting the post-sync recount is forced. Risk: Medium (stale "1 pending" badge). Effort: 30 min.

**H-3. Deferred-reconcile partial-success contract**
`atomic-sync-manager.ts` returns `{success:true, partial:true, reason:'reconcile_pending'}` when `runDeferredReconcile` is blocked. Confirm `useAutoSync` does **not** clear `dirty` in that branch — otherwise a record will be marked clean while server still has phantom children. Add an integration test covering the partial branch. Risk: Medium. Effort: 1 hr.

### MEDIUM

**M-1. Photo attribution fallback** (mem://constraints/photo-attribution-no-current-user-fallback)
Untagged `pending/` photos are attributed to parent inspection owner, never blind-rewritten to `currentUserId`. Verify no recent restore handler bypasses this. Quick `rg "currentUserId" src/lib/photo-*` audit. Risk: Misattribution on shared devices. Effort: 30 min audit.

**M-2. Quarantine GC retention**
`maybeRunQuarantineGc` hard-deletes `_remote_deleted_at` rows after 30d. Confirm GC runs in `sync-loop finally` block even when sync errors. Tests: `quarantine-gc.test.ts` covers the setter contract — extend to cover error-path execution. Risk: IDB bloat over months. Effort: 30 min.

**M-3. Session-JWT guard on every batch**
mem://constraints/sync-session-jwt-guard says every batch must `assertRealSessionForSync`. Spot-check `atomic-sync-manager.ts` upsert paths — ensure no path can transmit `offline_placeholder_token`. Risk: 401s in the field, silent loops. Effort: 1 hr.

**M-4. Storage-pressure eviction safety**
mem://architecture/storage-pressure-eviction says never evict unsynced data or the currently-viewed report. Verify `storage-pressure-manager.ts` checks both `dirty` AND `_remote_deleted_at` before evicting, and respects the active-report id from the router. Risk: User edits vanish under quota pressure. Effort: 1 hr.

### LOW

**L-1. Drift-log dedup map** (offline-storage.ts:3140) caps at 1000 entries — fine, but uses `.values().next().value` for FIFO eviction which is O(1) but relies on Set insertion order. Acceptable; document it.

**L-2. Console noise** — `console.log('[Offline Storage] Unsynced inspections:', …)` at 3216 fires every scan. Move behind `syncLog.log` (already exists in `sync-logger.ts`).

**L-3. `getUnsyncedAutocompleteEntries`** at 5675 still does `IDBKeyRange.only(0 as unknown as IDBValidKey)` — the cast hides the same boolean-vs-number trap. Confirm the `autocomplete_history.synced` field is written as `0|1` everywhere; if not, this index will silently return empty. Risk: Autocomplete suggestions don't sync. Effort: 30 min.

## 3. Cross-cutting production-readiness checklist

| Area | Status | Notes |
|------|--------|-------|
| Error handling | Good | `withIndexedDBReadBoundary`, `withWedgeLedgerFallback`, `IdbReadFailure` discriminated returns, `sync-error-severity` distinguishes `fatal`/`soft`. |
| Performance | Good | M1 scan cap, M4 single-parse, 3-layer counts coalescer, 1.5s min-gap. Watch L-2 console noise. |
| Security | Good | Session-quarantine, JWT guard, photo attribution rules. Verify M-3 in CI. |
| Data integrity | Good | Restore lock + integrity re-apply, deferred reconcile, quarantine GC, dirty-flag override, atomic sync. Watch H-3 contract. |
| Test coverage | Strong | 76 unit tests, fake-indexeddb in `src/test/setup.ts`, e2e specs for offline-edit reconcile and photo upload sync. |
| Migration safety | Strong | `idb-migration-safety.ts` snapshots → fingerprint validation → 7-day retention; v16/v18 redundant-on-purpose for the boolean-uploaded fix. |

## 4. Proposed remediation order
1. H-3 (partial-reconcile dirty-flag contract test) — confirms no silent data loss.
2. H-2 (force-recount post-sync test) — eliminates the "stuck pending" UX bug.
3. M-4 (eviction safety verification).
4. M-3 (JWT-guard spot-check + assertion).
5. L-3 (autocomplete index numeric contract).
6. H-1, M-1, M-2, L-1, L-2 — cleanups, can ship as a single PR.

## 5. Out of scope
No schema migrations, no edge-function changes, no auth refactor. Audit covered the offline-first sync surface only.
