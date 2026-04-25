# Dashboard report count discrepancy (51 → 44)

## 1. What the user is seeing

- The Inspections card and tab label sometimes show **51**, sometimes **44**.
- The number is not random — it reliably "drops" to 44 after the app talks to the server, and "rises" to 51 again later (e.g. after a refresh on a slower connection, or when offline).

## 2. Which number is correct?

**44 is the true count.** Direct query against the live database:

```
active inspections (deleted_at IS NULL): 44
soft-deleted (deleted_at IS NOT NULL):   22
grand total rows:                        66
```

The server holds 44 active inspections for the current view. The 51 shown locally is **stale cache** that includes 7 inspections which were soft-deleted on the server but never removed from this device's local copy.

## 3. Why it fluctuates (mechanism)

The dashboard uses a "stale-while-revalidate" load:

```text
                ┌──────────────────────┐
   open page →  │ 1. Read local cache  │ → render immediately (shows 51)
                └──────────┬───────────┘
                           │
                           ▼
                ┌──────────────────────┐
                │ 2. Fetch from server │ → render again      (shows 44)
                └──────────┬───────────┘
                           │
                           ▼
                ┌──────────────────────┐
                │ 3. Save server rows  │  ← BUG: only ADDS / UPDATES.
                │    back into cache   │     Never REMOVES rows the
                └──────────────────────┘     server no longer returns.
```

Code path:

- `src/pages/Dashboard.tsx` → `loadInspections()` reads `getOfflineInspections()` first (cache → **51**), then fetches Supabase (server → **44**), then writes each server row back into IndexedDB.
- `src/lib/offline-storage.ts` → `getOfflineInspections()` returns every IDB row whose `deleted_at` is null and is `isNotQuarantined`. Locally-soft-deleted rows are filtered, but **server-soft-deleted rows are not**, because nothing in this load path tells the cache "these 7 rows no longer exist remotely."
- The "remote-deleted" quarantine flag (`_remote_deleted_at`) is only set during the active sync pipeline (`atomic-sync-manager`), not during the dashboard read. So if a row is deleted server-side from another device while sync isn't actively touching it, the local cache keeps it forever.

Result: every page load briefly shows the cached 51, then snaps to the authoritative 44 once the network response lands. Offline, you stay at 51 indefinitely.

## 4. Fix plan

Reconcile the local cache against the server response inside `loadInspections` (and the matching `loadTrainings` / `loadDailyAssessments`) so that rows the server no longer returns are quarantined locally instead of lingering.

### Implementation

1. **`src/pages/Dashboard.tsx` — `loadInspections` (and the two siblings)**
   After a successful server fetch, diff the server row IDs against the local IDB IDs *for the same owner scope* (current user, or all users for super-admin). For each local row that is missing from the server response and is **already synced** (`synced_at` set, `dirty !== true`, no `temp-` id), mark it as remote-deleted by setting `_remote_deleted_at` + `_quarantine_reason = 'missing_from_server'`. This reuses the existing `isNotQuarantined` filter, so the next render immediately drops them.

2. **Safety guards (do not delete user work):**
   - Skip rows with `dirty === true`, `synced_at` missing, or `id` starting with `temp-` — those are unsynced local edits and must stay visible until the sync pipeline resolves them (consistent with the existing ownership / session-quarantine rules in `useAutoSync`).
   - Only run the diff when the network fetch actually succeeded and returned a non-null array (already gated on `networkData && networkData.length > 0`); never reconcile from an empty/failed response.
   - Only consider local rows in the same scope the server query covered (super-admin → all; regular user → `inspector_id === userId`).

3. **Existing GC keeps working:** `_remote_deleted_at` rows are already swept after 30 days by `maybeRunQuarantineGc` (see `mem://architecture/quarantine-gc`), so this does not grow IDB unbounded.

4. **No schema or RLS change required** — server already authoritative; this is purely a client cache reconciliation fix.

### Files to change

- `src/pages/Dashboard.tsx` — add a `reconcileDeletedAgainstServer(localRows, serverRows, scope)` helper used inside `loadInspections`, `loadTrainings`, and `loadDailyAssessments` right after a successful network fetch, before the existing per-row `saveInspectionOffline` background write.
- `src/lib/offline-storage.ts` — add a small `markRemoteDeleted(store, id, reason)` helper that stamps `_remote_deleted_at` + `_quarantine_reason` (parallel to the existing quarantine writes used by `atomic-sync-manager`).

### Verification after the fix

- Reload the dashboard online: count should immediately settle on **44** and stay there (no flash to 51).
- Go offline, reload: still **44** (cache reconciled on previous online load).
- Confirm no unsynced drafts disappear: any row with `dirty: true`, missing `synced_at`, or a `temp-` id remains visible.

## Non-technical summary

Your device keeps a local copy of reports so the dashboard is fast and works offline. When reports get deleted on the server from another device, your local copy was not being told to drop them — so it kept showing 51, then briefly corrected itself to 44 every time the server replied. The fix is to compare the server's list with the local copy on every successful load and quietly retire the leftovers (while protecting any unsynced work). After the fix, the count will be **44** consistently, online or offline.
