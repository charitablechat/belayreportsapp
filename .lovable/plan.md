

## Eliminate every remaining vector that can wipe child rows

The previous pass closed the three highest-traffic vectors (form-loader empty-server-array, Dashboard cache `synced_at` bump, reconciler over-prune). Auditing the rest of the data path reveals **five more vectors** that can still silently remove child rows. This plan closes all of them and adds a final tripwire that prevents any future regression from reaching production data.

---

### The five remaining vectors

**V4 — Reconciler still allows pruning when `serverCount ≤ 2`**
`src/lib/sync-reconciliation.ts` line 72: the foreign-device guard only triggers when `serverCount > 2`. A report with exactly 1 or 2 child rows on the server can still be wiped if a partial local read happens. The 50% rule should apply at every size, with a minimum-server-rows threshold tuned for safety, not skipped entirely.

**V5 — Reconciler trusts `localItems` even when caller passed an empty array because IDB read failed**
`reconcileChildTable` only sees the array the caller hands it. If `getRelatedDataOffline` silently returned `[]` due to the 5-second IDB timeout (already visible in the live console: `[Offline Storage] Operation timed out after 5000ms (269 similar warnings suppressed)`), the reconciler will treat that as "user deleted everything" and prune the server. The atomic-sync-manager already has an `empty_local_guard` for the *combined* totals across all child tables, but per-table reconciliation runs **before** that guard would help, and the guard only fires when *every* table is empty. A table-by-table empty-but-IDB-may-have-failed signal is missing.

**V6 — Service-worker `syncInspectionsAtomic` never reconciles, but it also has no per-table empty guard**
`public/sw-sync.js` lines 295-392: the SW path uses upsert-only (good — no deletes) and does have a combined-empty `suspicious_empty_guard`. But it still marks `synced_at = now` even when individual child tables are empty due to silent IDB read failures. Once the SW marks the parent synced, the reconciler on the next main-thread sync will see "local has 0, server has 5" → blocked by the previous fix's V3 zero-guard. So this doesn't directly delete data, but it *desynchronizes* the device's state and is a confusing quiet failure mode. Worth tightening.

**V7 — `admin-edit-snapshot.ts` does an unconditional delete-then-insert during restore**
Lines 198-214: `restoreAdminEditSnapshot` deletes every child row by `fk = report_id` and then re-inserts the snapshot. If the snapshot's `children[table]` array is empty (because at snapshot time IDB had a partial read), every child row on the server will be permanently destroyed and replaced with nothing. This is a one-click admin button. Needs a non-empty assertion + audit log entry before the delete.

**V8 — Storage-pressure eviction can race with an in-flight edit on a closed tab**
`getCurrentReportId()` in `src/lib/offline-storage.ts` only checks the *current* route. If the user has the app open in two tabs (or closed the form tab without sync completing), the eviction-protection misses it. `evictSyncedReports` then deletes the parent + all child stores in one transaction. The `synced_at >= updated_at` guard *should* catch this, but if the SW just stamped `synced_at = now` on a parent whose children failed to upload (V6), eviction destroys the local copy. Need a "has unsynced photos for this report" check before evicting.

---

### Fixes

1. **`src/lib/sync-reconciliation.ts`** — strengthen the partial-read detection
   - Drop the `serverCount > 2` floor; apply the 50%-of-server rule at any size where `serverCount >= 1`.
   - Add an absolute-delta tripwire: if `serverCount - localCount >= 3`, always block (catches the case where local lost 3+ items in one read).
   - Add a new `expectedNonEmpty?: boolean` parameter so callers can signal "I know I had a successful IDB read for this table." When `false` and `localCount === 0`, never prune.

2. **`src/lib/atomic-sync-manager.ts`** — instrument the IDB reads with success flags
   - Wrap each `getRelatedDataOffline(...)` call in a small helper that returns `{ items, readSucceeded }` based on whether `withIndexedDBErrorBoundary` hit its fallback. Pass `readSucceeded` through to `reconcileAllChildTables` as `expectedNonEmpty`. Three lines per table.
   - Apply the same pattern to `syncTrainingAtomic` and `syncDailyAssessmentAtomic`.

3. **`src/lib/admin-edit-snapshot.ts`** — make `restoreAdminEditSnapshot` safe
   - Before the per-table delete, assert `Array.isArray(rows) && rows.length > 0`. If the snapshot's table is empty, **skip the delete** entirely (preserve current server state) and log a warning.
   - Capture a `pre_restore` snapshot of the *current* server state into `admin_edit_snapshots` before applying the restore, so the operation itself is reversible.

4. **`public/sw-sync.js`** — refuse to stamp `synced_at` if any child IDB read returned 0 rows for a record that previously had non-zero children
   - Add a parent-level `child_count_hint` field stamped during normal saves (cheap: sum of all child counts at last successful save). At sync time, if the live read produces fewer total children than the hint by >50%, skip the sync for that record and log to the SYNC_COMPLETED message. Mirrors the field-count regression guard already in the main thread.

5. **`src/lib/offline-storage.ts`** — harden `evictSyncedReports`
   - In addition to `synced_at >= updated_at`, require `(Date.now() - syncedAt) >= ageDays * 86400 * 1000` *and* assert there are zero `photos` rows with `uploaded === false` for that report id. If any unsynced photo exists, skip eviction for that parent regardless of age.
   - Replace the route-only `getCurrentReportId()` check with a recently-edited check: read the parent's `updated_at` and skip if it is within the last 30 minutes, even if `synced_at` looks healthy.

6. **New tripwire — `src/lib/child-row-deletion-tripwire.ts`** (small new file, ~50 lines)
   - A single `assertSafeToDeleteChildRows(table, parentId, idsToDelete, context)` helper that every `.delete()` against a child table must call first. It does: (a) re-fetches the parent's current child count; (b) refuses if the deletion would remove >70% of children in one shot unless `context.bulk === true` is explicitly passed; (c) logs every refusal with full call-site context to `report_deleted_items` with `reason: 'tripwire_blocked'` so admins can review.
   - Wire it into `reconcileChildTable`, `transaction-manager.ts` rollback paths (lines 100, 185, 188, 192, 213), and `admin-edit-snapshot.ts`. That covers every direct child-row deletion in the codebase.

7. **Diagnostic surface** — add a one-line entry to the existing `SyncDiagnosticsSheet` showing "Child-row deletions blocked in last 24 h: N" pulled from `report_deleted_items` filtered by `reason = 'tripwire_blocked'`. Lets ops see the tripwire firing in the wild without log diving.

---

### Files to edit

- `src/lib/sync-reconciliation.ts` — V4 + V5 guard tightening, accept `expectedNonEmpty` flag
- `src/lib/atomic-sync-manager.ts` — pass IDB-read-succeeded signal into reconciler (3 sync functions)
- `src/lib/admin-edit-snapshot.ts` — V7: empty-array guard + pre-restore snapshot
- `public/sw-sync.js` — V6: child_count_hint regression guard
- `src/lib/offline-storage.ts` — V8: unsynced-photo + recently-edited eviction guards
- `src/lib/transaction-manager.ts` — route rollback child deletes through the tripwire
- `src/lib/child-row-deletion-tripwire.ts` — NEW (~50 lines)
- `src/components/pwa/SyncDiagnosticsSheet.tsx` — show blocked-deletion counter

No DB migrations required (`report_deleted_items` already exists). No edge functions changed. No new dependencies.

### Verification

1. Force IDB to return `[]` for one child table during sync (DevTools throttle + 5 s timeout). Sync proceeds, reconciler skips that table, server data stays intact, parent is *not* marked as synced → ✓
2. Admin clicks "Restore" on a snapshot whose `children` is `{}` for one table. That table is left untouched on the server, warning is logged → ✓
3. SW-only sync (close all tabs) on a record with stale IDB. SW refuses to stamp `synced_at`, queues for next cycle → ✓
4. Storage-pressure tier 3 fires while user has unsynced photos for a report not in the URL. Eviction skips that report → ✓
5. Run a pathological deletion (e.g. 10/10 server children with 0 local). Tripwire blocks, logs to `report_deleted_items` with `reason: 'tripwire_blocked'`, diagnostics shows the blocked count → ✓

### Risk

- **False positives blocking legitimate large deletions.** Mitigated by the explicit `context.bulk = true` opt-out and by the existing 3-cycle skip counter in the main thread (`MAX_REGRESSION_SKIPS`). After 3 consecutive blocks, the next sync proceeds.
- **Tripwire re-fetch adds one network round-trip per child-table delete.** Acceptable: child-table deletions are rare events, and this is the data-loss path we're hardening.
- **No effect on save speed.** All tripwire work happens inside sync, not inside the user's save path.

### Out of scope

- Server-side `BEFORE DELETE` triggers on child tables (would require migration; can be added later as belt-and-braces if the client-side tripwire proves insufficient).
- Changing the LWW/field-merge model.
- The published v4.6.7 still won't get any of this until the next Publish — same as before.

