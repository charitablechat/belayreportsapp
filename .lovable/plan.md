

## Final Security Audit: Local Data Loss Vectors in Sync Lifecycle

This audit systematically examines every scenario where local data (IndexedDB, localStorage) can be lost during the synchronization process, confirms existing mitigations, and identifies any remaining gaps.

---

### PHASE 1: COMPLETE VECTOR INVENTORY

Every code path that deletes, overwrites, or clears local data has been traced across `atomic-sync-manager.ts`, `sw-sync.js`, `offline-storage.ts`, `sync-reconciliation.ts`, `local-backup-ledger.ts`, `transaction-manager.ts`, `Dashboard.tsx`, `useEmptyReportCleanup.tsx`, and `useSoftDelete.tsx`.

---

### CATEGORY A: VECTORS FULLY MITIGATED (No Action Needed)

| # | Vector | Mitigation | Confidence |
|---|--------|-----------|------------|
| 1 | **IndexedDB timeout returns `[]`, auto-save overwrites real data** | `childDataLoadedRef` guard in all 3 form files. Auto-save skips writing empty arrays unless the data was confirmed loaded. | HIGH |
| 2 | **Server empty arrays overwrite local React state on form load** | Non-regression guards in InspectionForm, TrainingForm, DailyAssessmentForm prevent replacing non-empty local state with empty server arrays. | HIGH |
| 3 | **SW false-success sync (parent syncs, children don't)** | 3-step deferred `synced_at` pattern in both `atomic-sync-manager.ts` (lines 530-537) and `sw-sync.js` (lines 166-179). `synced_at` only stamps after all children commit. `verifyResponseRows` validates each write. Post-sync read-back (lines 182-195) confirms server state. | HIGH |
| 4 | **Empty report auto-delete on exit** | `hasUserInteracted` guard in `useEmptyReportCleanup.tsx` (line 124). Soft-delete with 60-day retention (line 146-151). WAL backup before delete in `deleteOfflineInspection` (lines 682-691). | HIGH |
| 5 | **Dashboard orphan cleanup deletes unsynced records** | Recency check: 60s for updates, 5min for creates (lines 469-474). `isSyncInProgress()` guard (line 461). Orphan log in localStorage (lines 477-480). `temp-` IDs excluded (line 465). | HIGH |
| 6 | **QuotaExceededError silently drops writes** | Immediate destructive toast on first occurrence (lines 438-448). Excluded from circuit breaker threshold (line 432). | HIGH |
| 7 | **Concurrent save race conditions within a single store** | Single-transaction atomic delete+put in `saveRelatedDataOffline` (lines 1104-1124). All ops in one IDB transaction. | HIGH |
| 8 | **Admin soft-delete cascades to local data** | `check_record_status` RPC bypasses RLS. Pre-delete WAL backup via `appendVersion('pre_delete')` (lines 246-248). | HIGH |
| 9 | **Field-count regression during sync** | 50% drop threshold blocks sync (lines 344-355). Pre-sync version snapshot (lines 335-337). | HIGH |
| 10 | **Auth token expiry during sync (RLS returns 0 rows)** | `.select('id')` row-count verification in `transaction-manager.ts` (lines 100-113). `verifyResponseRows` in SW (lines 99-109). | HIGH |
| 11 | **`saveRelatedDataOffline` called with empty array** | Guard at line 1093: `if (data.length === 0 && !options?.allowEmpty) return;` -- blocks destructive empty writes unless `allowEmpty` is explicit. | HIGH |
| 12 | **`clearRelatedDataOffline` on non-temp IDs** | Guard at line 1158: blocks clear on non-temp IDs unless `bypassTempGuard` is explicitly set. | HIGH |
| 13 | **Transaction manager DELETE on report tables** | `REPORT_TABLE_BLOCKLIST` (lines 22-34) blocks all delete operations on report tables at runtime. | HIGH |
| 14 | **SW opens IndexedDB at wrong version** | Fixed: all `openDB` calls in `sw-sync.js` now use version 8, matching main thread. | HIGH |
| 15 | **localStorage snapshot written after IDB writes (lost on mid-write crash)** | Fixed: `saveReportSnapshot` now fires BEFORE `Promise.all` of IndexedDB writes. | HIGH |
| 16 | **Circuit breaker trips silently during form editing** | Fixed: `useStorageHealthCheck` hook polls every 30s, persistent red banner shown. | HIGH |
| 17 | **Force refresh clears caches with unsynced data** | Fixed: `ManualUpdateButton` checks `unsyncedCount` before cache clear, offers "Sync First". | HIGH |
| 18 | **Suspicious empty guard (main thread)** | Lines 447-464: blocks sync if record was edited >60s but ALL child arrays are empty. Returns `skipped: true`. | HIGH |
| 19 | **Suspicious empty guard (service worker)** | Lines 237-249 (inspections), 406-417 (trainings), 534-546 (assessments): identical guard in SW. | HIGH |
| 20 | **Empty local guard (server has data, local is empty)** | Lines 383-443: if server has child data but local is completely empty, sync is blocked. Recovery path pulls server data into local cache and re-aligns timestamps. | HIGH |

---

### CATEGORY B: RESIDUAL RISKS (Acceptable, No Code Change Needed)

| # | Vector | Risk Level | Why Acceptable |
|---|--------|-----------|---------------|
| B1 | **Browser evicts IndexedDB (iOS Safari, storage pressure)** | LOW | Three-layer backup: IndexedDB (primary) + localStorage ledger (secondary) + server (tertiary). Circuit breaker banner now warns user. Unsynced ledger snapshots are never evicted. |
| B2 | **localStorage itself cleared by user/browser** | LOW | Tertiary backup only. IndexedDB + server still hold data. Would require all 3 layers to fail simultaneously. |
| B3 | **Photo blobs evicted from IndexedDB under storage pressure** | LOW | `photo-receipts` system preserves metadata. `PhotoGallery` shows warning indicators. Only permanent if user never goes online. |
| B4 | **`Promise.all` across multiple IDB stores is non-atomic** | LOW | Fixed by writing localStorage snapshot FIRST (before IDB writes), so backup always has latest React state even if tab is killed mid-write. |
| B5 | **Dashboard caches only parent records (no child data offline)** | LOW | `childDataLoadedRef` prevents destructive auto-save. Offline empty-form banner informs user to reconnect. UX issue, not data loss. |

---

### CATEGORY C: REMAINING UNMITIGATED VECTOR (1 Found)

#### Vector C1: Reconciliation Deletes Server Rows Based on Potentially Stale Local State

**Location**: `sync-reconciliation.ts` lines 57-76

**Scenario**: `reconcileChildTable` compares server-side child IDs against local IDs. Any server row NOT in the local set is deleted from the server and logged to `report_deleted_items`. This is correct when the user intentionally removed rows locally. However:

- If local IndexedDB returns a **partial** set of child records (e.g., 3 of 5 systems load due to an interrupted read or corruption), the reconciler will delete the 2 "missing" rows from the server -- genuine data that the user never removed.
- The `suspicious_empty` guard only fires when ALL children are empty. A partial read (some items present, some missing) bypasses this guard entirely.

**Current mitigation**: Deleted rows are logged to `report_deleted_items` (audit table) for Super Admin recovery. But the user has no visibility that rows were removed.

**Risk level**: MEDIUM. Partial IDB reads are rare but possible during storage pressure, version upgrades, or tab crashes mid-write.

**Proposed fix** (minimal, non-breaking):

Add a **partial-read detection** check in `reconcileChildTable`. Before deleting server rows, compare the ratio of local items to server items. If local has significantly fewer items than the server (e.g., less than 50%), log a warning and skip reconciliation for that table, preserving server data.

```typescript
// In reconcileChildTable, before line 58:
const localCount = localItems.filter(i => i.id && !i.id.startsWith('temp-')).length;
const serverCount = serverRows.length;

// If local has < 50% of server rows, this is suspicious -- likely a partial read
if (serverCount > 2 && localCount > 0 && localCount < serverCount * 0.5) {
  console.warn(`[Reconcile] BLOCKED: ${childTable} local has ${localCount}/${serverCount} rows -- possible partial read, preserving server data`);
  return { deletedCount: 0, deletedRows: [] };
}
```

**Files to modify**: `src/lib/sync-reconciliation.ts` (add ~6 lines before the deletion logic)

---

### SUMMARY

| Status | Count | Details |
|--------|-------|---------|
| Fully Mitigated | 20 | All critical vectors covered by existing guards |
| Acceptable Risk | 5 | Tertiary/environmental risks with no practical code fix |
| **Unmitigated** | **1** | Reconciliation partial-read gap (Vector C1) |

### Recommended Action

Implement the partial-read detection guard in `sync-reconciliation.ts`. This is a 6-line addition that prevents the reconciler from deleting server rows when local data appears incomplete. No other data loss vectors remain unaddressed.

