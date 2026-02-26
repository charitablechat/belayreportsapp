

## Comprehensive Data Loss Audit

After a thorough review of every file involved in data persistence, synchronization, and deletion, here is a complete inventory of every path where data can be lost, along with the current mitigation status and proposed fixes for unmitigated vectors.

---

### ALREADY MITIGATED (No Action Needed)

These vectors have existing guards in place:

| # | Vector | Mitigation |
|---|--------|-----------|
| 1 | **IndexedDB timeout returns empty array, auto-save overwrites real data** | `childDataLoadedRef` guard (just implemented) |
| 2 | **Server empty arrays overwrite local React state** | Non-regression guards in all 3 forms |
| 3 | **Service Worker false-success sync (shell syncs, children don't)** | 3-step deferred `synced_at`, `verifyResponseRows`, suspicious-empty guard |
| 4 | **Empty report auto-delete on exit** | `hasUserInteracted` guard, soft-delete with 60-day retention |
| 5 | **Dashboard orphan cleanup deletes unsynced records** | Recency check (60s/5min), sync-in-progress guard, 50% threshold, localStorage snapshot |
| 6 | **QuotaExceededError silently drops writes** | Immediate user toast, circuit breaker excludes quota errors |
| 7 | **Concurrent save race conditions** | Single-transaction atomic IndexedDB writes (delete + put in one tx) |
| 8 | **Admin soft-delete removes data the user can't see** | `check_record_status` RPC bypasses RLS, pre-delete WAL backup |
| 9 | **Field-count regression during sync** | 50% drop threshold blocks sync |
| 10 | **Auth token expiry during sync** | `.select('id')` row-count verification, upsert fallback |

---

### UNMITIGATED VECTORS FOUND (Require Fixes)

#### Vector A: Browser "Clear Site Data" / Private Browsing Eviction

**Risk**: The browser can evict IndexedDB at any time (especially non-persistent storage on iOS Safari). The `localStorage` backup ledger survives this, but is limited to 4MB and only stores the LAST snapshot per report. If IndexedDB is evicted mid-session, auto-save will fail silently (circuit breaker trips) but the user won't know their data is no longer persisting.

**Current state**: A one-time banner warns about non-persistent storage, but after dismissal, there's no ongoing indicator.

**Fix**: Add a periodic "storage heartbeat" check during active form editing. If IndexedDB becomes unreachable during a session (circuit breaker trips), show a persistent red banner at the top of the form: "Local storage unavailable -- your changes are at risk. Please stay connected to sync." This uses the existing `getCircuitBreakerStatus()` function.

**Files**: `src/pages/InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx` -- add a `useEffect` that polls `getCircuitBreakerStatus()` every 30 seconds and shows a persistent alert when `open === true`.

---

#### Vector B: `saveRelatedDataOffline` Delete-Then-Put Non-Atomicity Across Stores

**Risk**: `saveRelatedDataOffline` (line 1098) uses a single IndexedDB transaction that deletes all existing items and puts new ones. This IS atomic within one store. However, the form's `performSave` calls `Promise.all` across 5-6 different stores (systems, ziplines, equipment, etc.). If the page is killed mid-way (e.g., iOS kills the tab), some stores may have been updated while others haven't, leaving the report in a partially-saved state.

**Current state**: Emergency save fires on `visibilitychange`/`pagehide` but is fire-and-forget. The localStorage backup ledger is the safety net, but it only captures the state at the LAST successful IndexedDB write.

**Fix**: Update the `localStorage` snapshot to be written BEFORE the IndexedDB writes (not after). This ensures the backup always has the latest React state, even if IndexedDB writes are interrupted. Currently `saveReportSnapshot` is called after IndexedDB succeeds. Move it to fire FIRST in `performSave`.

**Files**: `src/pages/InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx` -- reorder `saveReportSnapshot` call to execute before the `Promise.all` of IndexedDB writes.

---

#### Vector C: `ManualUpdateButton` "Force Refresh" Clears Service Worker Caches

**Risk**: The `ManualUpdateButton` (line 116-118) calls `caches.keys()` and `caches.delete()` on ALL caches, then reloads the page. This clears the service worker app shell cache, meaning the app won't work offline until the SW repopulates. More critically, if IndexedDB is also unhealthy at this point, the user has no local persistence layer at all.

**Current state**: A confirmation dialog warns about offline unavailability, but doesn't check for unsynced data first.

**Fix**: Before clearing caches, check `unsyncedCount` from PWA context. If > 0, show a warning: "You have X unsynced reports. Force refreshing will not delete your data, but the app won't work offline until you reconnect. Sync first?" Add a "Sync First" button option.

**Files**: `src/components/pwa/ManualUpdateButton.tsx` -- add unsynced-data check before cache clear.

---

#### Vector D: Service Worker Opens IndexedDB at Version 4, Main Thread at Version 8

**Risk**: The service worker (`sw-sync.js` line 210) opens IndexedDB at version 4: `openDB('rope-works-inspections', 4)`. The main thread opens at version 8 (line 464 of `offline-storage.ts`). If the SW opens the DB first after a fresh install, it creates the DB at v4 without the v7/v8 stores (`report_backups`, `report_versions`). When the main thread later tries to open at v8, the `upgrade` callback fires and adds the missing stores. This is generally fine but creates a timing window where the SW could be reading from a DB that's mid-upgrade, potentially causing read failures that return empty arrays.

**Current state**: No version alignment between SW and main thread.

**Fix**: Update `sw-sync.js` to open IndexedDB at version 8 (matching the main thread). The SW doesn't need the `report_backups` or `report_versions` stores, but opening at the correct version prevents upgrade conflicts.

**Files**: `public/sw-sync.js` -- change `openDB('rope-works-inspections', 4)` to `openDB('rope-works-inspections', 8)` in all 3 sync functions (lines 210, 383, 534).

---

#### Vector E: Dashboard Caches Server Data Without Child Records

**Risk**: When the Dashboard saves server data to IndexedDB (lines 426-438), it only saves the PARENT record (inspection shell). It does NOT cache child records (systems, ziplines, etc.). If the user goes offline after the Dashboard loads, then opens a report, the form loads the parent from IndexedDB but child data may be empty (no server child data was cached locally). The `childDataLoadedRef` guard (just implemented) prevents auto-save from overwriting, but the user sees an empty form with no way to populate it offline.

**Current state**: Only parent records are cached on Dashboard load. Child data is only available if the user previously opened the form while online.

**Fix**: This is a UX issue rather than a data loss issue (the `childDataLoadedRef` guard prevents destructive writes). However, a "Data not available offline" banner should appear when child data fails to load AND the user is offline, informing them to reconnect.

**Files**: Already partially handled by the non-regression guards. Add an informational banner in the form when offline AND all child arrays are empty AND `childDataLoadedRef` flags are all false.

---

#### Vector F: `localStorage` Backup Ledger Eviction Loses Only Recovery Copy

**Risk**: The backup ledger has a 4MB budget and uses LRU eviction of SYNCED snapshots. Unsynced snapshots are never evicted. However, if `localStorage` itself is cleared (user clears browser data, or browser does it under storage pressure), all snapshots are lost. This is the last-resort recovery layer -- losing it means only IndexedDB and the server have data.

**Current state**: Acceptable risk given it's a tertiary backup, but worth noting.

**Fix**: No code change needed. The three-layer architecture (IndexedDB primary, localStorage backup, server sync) means all three would need to fail simultaneously for permanent loss. The `childDataLoadedRef` guard now prevents the most dangerous scenario (IndexedDB timeout -> empty write -> backup overwritten with empty).

---

#### Vector G: Photo Blob Eviction from IndexedDB

**Risk**: Photo blobs stored in IndexedDB can be evicted by the browser under storage pressure (they're large). The `photo-receipts` system stores lightweight metadata in localStorage, and the `PhotoGallery` component shows warning indicators for evicted photos. However, if the photo was never uploaded to the server (offline capture), the binary data is permanently lost.

**Current state**: Warning indicators exist but no re-capture prompt.

**Fix**: Already mitigated with receipt system and WAL backup. The main risk is if the user never goes online to sync photos. No additional code change needed -- the existing architecture handles this correctly.

---

### Summary of Required Changes

| Priority | Vector | Fix | Files |
|----------|--------|-----|-------|
| **High** | D: SW version mismatch | Change `openDB` version from 4 to 8 in SW | `public/sw-sync.js` |
| **High** | B: localStorage snapshot timing | Write snapshot BEFORE IndexedDB writes | 3 form files |
| **Medium** | A: Circuit breaker banner | Show persistent warning when circuit breaker trips during editing | 3 form files |
| **Medium** | C: Force refresh unsynced check | Check unsyncedCount before cache clear | `ManualUpdateButton.tsx` |
| **Low** | E: Offline empty-form banner | Show info banner when child data unavailable offline | 3 form files |
| **None** | F: localStorage eviction | Acceptable risk (tertiary backup) | -- |
| **None** | G: Photo eviction | Already mitigated with receipts | -- |

### What This Plan Does NOT Change

- No changes to IndexedDB schema or sync logic
- No DELETE, `.clear()`, or overwrite operations added
- No changes to the server-side database or RLS policies
- Existing data is never touched

