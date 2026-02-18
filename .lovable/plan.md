

# Comprehensive Audit: IndexedDB Sync and Data Persistence Layer

## Audit Methodology

Traced the complete data lifecycle across 15 core files: form input to React state, state to IndexedDB, IndexedDB to server sync, server responses back to local cache, and emergency save paths. Each finding is categorized by risk level and includes the exact code location.

---

## Finding 1: Hardcoded Anon Key in Service Worker (SECURITY)

**Risk: SECURITY / LOW** (anon key is publishable, but violates stated requirement)

**Location:** `public/sw-sync.js` lines 125-126 and 247-248

The service worker contains two hardcoded instances of the Supabase anon key and project URL. While the anon key is technically a publishable key (not a secret), the user's requirements explicitly state: *"Ensure no sensitive API keys or secrets are stored in the frontend code."* The anon key grants unauthenticated access scoped by RLS, so this is acceptable architecturally -- but the SW bypasses RLS entirely by using the anon key without a user JWT, meaning it can only write data that RLS allows for `anon` role. If any RLS policy allows `anon` inserts/updates, this is a real risk.

**Fix:** Import the key from environment config or pass it via `postMessage` from the main thread during SW registration. However, service workers cannot access `import.meta.env`, so the practical approach is to inject these values at build time via the Vite PWA plugin config.

---

## Finding 2: `performSave` Lacks Save Mutex Guard (RACE CONDITION)

**Risk: HIGH**

**Location:** `src/pages/InspectionForm.tsx` line 1118

The `performSave` function does NOT check or set `anySaveInProgressRef` before executing. Multiple concurrent calls can execute simultaneously:

1. Auto-save fires from the 1.5s debounce timer
2. Emergency save fires from `visibilitychange`
3. The 10-second backup interval fires from `setInterval`
4. `handleHeaderUpdate` triggers a 500ms debounced save

All four paths call `performSaveRef.current(true)` without checking if a save is already in progress. This means two saves can run simultaneously, each reading state at different points, and the second save's `updated_at` may overwrite the first's server write.

**Fix:** Wrap `performSave` with the `anySaveInProgressRef` mutex:
```
if (anySaveInProgressRef.current) return;
anySaveInProgressRef.current = true;
try { ... } finally { anySaveInProgressRef.current = false; }
```
This pattern already exists conceptually (the ref is declared) but is never actually checked in `performSave`.

---

## Finding 3: Emergency Save is Fire-and-Forget with No Completion Guarantee (LIFECYCLE)

**Risk: MEDIUM**

**Location:** `src/hooks/useEmergencySave.tsx` line 56

The emergency save calls `performSaveRef.current?.(true)` as fire-and-forget during `visibilitychange` and `pagehide`. On iOS Safari, the browser can terminate the page before the async IndexedDB write completes. The `onEmergencySnapshot` callback (localStorage) provides a synchronous fallback, but the main IndexedDB save path (`performSave`) involves multiple async `db.put()` calls across 6 stores (inspection + 5 child stores).

**Edge case:** If the user switches tabs mid-save (visibilitychange fires), the emergency save skips because `savingRef.current === true`. But the in-flight save may be interrupted by the browser before completing all 6 stores, leaving partial data in IndexedDB (e.g., inspection saved but equipment not saved).

**Fix:** The `onEmergencySnapshot` (localStorage) already covers this gap for the most part. To strengthen it further, the emergency save should still trigger the localStorage snapshot even when `savingRef.current === true`, since the in-flight save may not complete. Currently line 47 returns early when `saving === true`, skipping both the IndexedDB save AND the localStorage snapshot.

---

## Finding 4: `shouldPreserveLocalRecord` Vulnerable to Clock Skew (CONFLICT RESOLUTION)

**Risk: MEDIUM**

**Location:** `src/lib/local-data-guards.ts` lines 23-34 and `src/pages/Dashboard.tsx` lines 382-394

The `shouldPreserveLocalRecord` function compares `updated_at` vs `synced_at` timestamps. These timestamps come from two different clocks:
- `updated_at` is set client-side via `new Date().toISOString()`
- `synced_at` is set server-side via `NOW()` or via the `align_synced_at` RPC

If the client clock is ahead of the server clock (common on mobile devices with incorrect time settings), a freshly synced record will have `updated_at > synced_at` even though no local changes exist. This causes `shouldPreserveLocalRecord` to return `true`, blocking all future server data from overwriting the local cache.

The Dashboard has a secondary check (lines 386-392) comparing `server.synced_at >= local.updated_at`, which partially mitigates this. But if the client clock was ahead when the report was last edited, the local `updated_at` will always exceed the server `synced_at`, permanently blocking cache updates.

**Fix:** After a successful sync in the atomic sync manager, set BOTH `updated_at` AND `synced_at` to the server-returned timestamp (this is already done at line 501 of `atomic-sync-manager.ts`). However, the form's `performSave` (InspectionForm line 1456-1461) only aligns timestamps when `hadFilteredItems` is false. When items have empty names, `updated_at` is intentionally kept ahead, which can trigger the same clock-skew false positive on the Dashboard.

---

## Finding 5: Realtime `handleRemoteChange` Can Trigger Redundant Sync Loops (SYNC LOOP)

**Risk: LOW-MEDIUM**

**Location:** `src/hooks/useAutoSync.tsx` lines 389-416

The `handleRemoteChange` callback fires on ALL Realtime postgres_changes events, including UPDATE events triggered by the app's own sync operations (e.g., `align_synced_at` RPC). The existing guards prevent a full loop:

1. `syncInProgressRef.current` check (line 405) blocks sync during active sync
2. `MIN_SYNC_INTERVAL` cooldown (line 408) blocks sync within 5s of last attempt
3. `triggerDebouncedSync` adds a 3s debounce (line 409)

**However**, there's a timing gap: after `syncInProgressRef.current` resets to `false` (line 301, finally block), the `align_synced_at` Realtime UPDATE event may still be in-flight in the Supabase channel. If it arrives within the gap between sync completion and the MIN_SYNC_INTERVAL expiry, it triggers a new debounced sync that re-reads IndexedDB, finds nothing to sync, but still fires `emitSyncComplete()` which triggers Dashboard reload. This creates unnecessary network chatter and Dashboard refreshes.

**Fix:** The `emitSyncComplete` already gates on `anySuccess` (line 262), so empty syncs don't trigger Dashboard reloads. The remaining issue is the unnecessary IndexedDB read. A stronger fix would be to add a post-sync cooldown period (e.g., 10s) during which Realtime events are ignored entirely.

---

## Finding 6: `dataFullyLoaded` Flag Does Not Exist -- No Premature Cleanup Risk Here

**Risk: NONE (clarification)**

The user asked about a `dataFullyLoaded` flag. This flag does not exist in the codebase. The Dashboard uses `setLoading(true/false)` for UI skeleton state, but this does NOT gate orphan cleanup. Orphan cleanup runs inside the `.then()` chain after `saveInspectionOffline` calls complete (Dashboard line 397), which means it only fires AFTER server data has been received and locally cached. The cleanup is properly guarded by:
- Threshold guard (50% drop check, line 412)
- `isSyncInProgress()` check (line 417)
- Recency guards (60s modified, 5min created, lines 425-429)
- 1-hour cooldown (line 400-404)

---

## Finding 7: `isInternalUpdateRef` Set in `setTimeout` Creates Timing Hazard (RACE CONDITION)

**Risk: MEDIUM**

**Location:** `src/pages/InspectionForm.tsx` lines 1362-1370 (and similar at 1393, 1424)

After inserting new records with server-generated UUIDs, the form replaces temp IDs in React state via `setTimeout(() => { isInternalUpdateRef.current = true; setSystems(...) }, 100)`. This 100ms delay creates a window where:

1. User types in a field (setting `hasUnsavedChanges = true`)
2. 100ms later, `isInternalUpdateRef.current = true` and `setSystems()` fires
3. The auto-save watcher effect (line 483-496) runs but skips because `isInternalUpdateRef.current === true`
4. The reset effect (line 501-505) runs and sets `isInternalUpdateRef.current = false`
5. BUT the user's actual edit from step 1 was part of the same render cycle and was skipped

This is mitigated by the 1.5s debounce -- the user's edit will trigger a subsequent render that the watcher catches. But if the user switches tabs immediately after step 1, the emergency save fires with stale state (the `setSystems` from step 2 hasn't been processed yet).

**Fix:** Instead of `setTimeout`, use `requestAnimationFrame` or a `useEffect` dependency to ensure the state update and internal flag are synchronized within the same React render cycle.

---

## Finding 8: Dual Server Write Path Creates Inconsistency Risk (ARCHITECTURE)

**Risk: LOW-MEDIUM**

**Location:** `src/pages/InspectionForm.tsx` line 1272 (performSave) AND `src/lib/atomic-sync-manager.ts` line 99 (syncInspectionAtomic)

The InspectionForm has TWO independent paths that write data to the server:

1. **Inline sync in `performSave`** (line 1272-1484): Directly calls `supabase.from("inspections").update()` and `supabase.from("inspection_systems").upsert()` etc.
2. **Background sync via `atomic-sync-manager.ts`**: The `useAutoSync` hook calls `syncAllInspectionsAtomic()` which reads from IndexedDB and writes to server via `executeTransaction()`.

Both can be active simultaneously. If the user is online and editing:
- `performSave` writes directly to server with the current state
- Meanwhile, `useAutoSync` fires its periodic sync, reads the SAME inspection from IndexedDB (which may have been written by a slightly earlier `performSave`), and upserts the same data

The result is usually idempotent (upserts are safe), but the `synced_at` timestamp can be set by both paths independently, causing the 2-second drift tolerance in `getUnsyncedInspections` (line 656) to incorrectly mark an already-synced record as unsynced.

**Fix:** No immediate fix needed -- the upsert-only pattern makes this safe from a data perspective. But to reduce unnecessary network traffic, `performSave` should update `synced_at` in IndexedDB after a successful server write to prevent the background sync from re-processing the same record.

---

## Summary Table

```text
+----+---------------------------------------------------+-----------+----------------------------------+
| #  | Finding                                           | Risk      | Location                         |
+----+---------------------------------------------------+-----------+----------------------------------+
| 1  | Hardcoded anon key in service worker               | SECURITY  | public/sw-sync.js:125-126        |
+----+---------------------------------------------------+-----------+----------------------------------+
| 2  | performSave lacks save mutex                       | HIGH      | InspectionForm.tsx:1118           |
+----+---------------------------------------------------+-----------+----------------------------------+
| 3  | Emergency save skips localStorage snapshot         | MEDIUM    | useEmergencySave.tsx:47           |
|    | when saving=true                                   |           |                                  |
+----+---------------------------------------------------+-----------+----------------------------------+
| 4  | shouldPreserveLocalRecord vulnerable to            | MEDIUM    | local-data-guards.ts:30          |
|    | client/server clock skew                           |           | Dashboard.tsx:386                |
+----+---------------------------------------------------+-----------+----------------------------------+
| 5  | Realtime events trigger unnecessary sync           | LOW-MED   | useAutoSync.tsx:389-416           |
|    | after own writes                                   |           |                                  |
+----+---------------------------------------------------+-----------+----------------------------------+
| 6  | dataFullyLoaded flag: NOT a risk                   | NONE      | (does not exist)                 |
+----+---------------------------------------------------+-----------+----------------------------------+
| 7  | setTimeout for isInternalUpdateRef creates         | MEDIUM    | InspectionForm.tsx:1362-1370      |
|    | timing hazard with emergency save                  |           |                                  |
+----+---------------------------------------------------+-----------+----------------------------------+
| 8  | Dual server write paths (inline + background)      | LOW-MED   | InspectionForm.tsx:1272           |
|    | cause redundant syncs                              |           | atomic-sync-manager.ts:99        |
+----+---------------------------------------------------+-----------+----------------------------------+
```

## Proposed Fixes

| File | Changes |
|------|---------|
| `src/pages/InspectionForm.tsx` | Add `anySaveInProgressRef` mutex check at top of `performSave`; replace `setTimeout` temp-ID replacement with `useEffect`-based approach |
| `src/hooks/useEmergencySave.tsx` | Always trigger `onEmergencySnapshot` even when `saving === true` (localStorage is synchronous and safe) |
| `src/hooks/useAutoSync.tsx` | Add 10-second post-sync cooldown for Realtime-triggered syncs |
| `public/sw-sync.js` | Note: anon key is publishable, no code change needed unless build-time injection is desired |
| `src/lib/local-data-guards.ts` | Add optional tolerance parameter for clock skew (e.g., 5-second window) |
| `src/pages/TrainingForm.tsx` | Verify same `performSave` mutex pattern applies |
| `src/pages/DailyAssessmentForm.tsx` | Verify same `performSave` mutex pattern applies |

## Security Confirmation

- The anon key in `public/sw-sync.js` is a **publishable key** (not a secret). It is the same key used by the Supabase client SDK and is safe to expose in frontend code. It grants access only within RLS policy boundaries.
- No service role keys, webhook secrets, VAPID private keys, or Resend API keys appear in any frontend code.
- All sensitive secrets are properly stored as backend secrets and only accessed from edge functions.

