

## Remaining Gaps in the Sync Pipeline

After reviewing all the code changes and the current state of the sync pipeline, here are the gaps that still exist:

### Gap 1: Service Worker Has No Row-Count Verification

The main-thread `transaction-manager.ts` now verifies that writes return rows (`.select('id')` + row-count check). But the service worker (`sw-sync.js`) uses raw `fetch()` calls and does **not** verify the response body contains actual rows.

**Specifically:**
- `syncInspectionWithTransaction()` (line 133): The PATCH to inspections checks `inspResponse.ok` but does not verify the response body contains a returned row. A PATCH to a non-existent ID returns `200 OK` with an **empty array** `[]`.
- `upsertRelatedData()` (line 98): Uses `return=representation` but never checks that the response body actually contains rows.
- Same issue in the training and daily assessment sync functions (lines 397, 425, 515, 543).

**Risk:** If the service worker fires while the user's JWT is expired or the record ID doesn't match RLS, the server returns `200 []` (success with 0 rows affected), and the SW marks the record as synced locally.

### Gap 2: Service Worker Uses Anon Key Instead of User's JWT

The service worker hardcodes `Authorization: Bearer ${supabaseKey}` where `supabaseKey` is the **anon key** (lines 109, 138, etc.). This means all SW writes authenticate as the anonymous role, not the logged-in user. RLS policies that check `auth.uid()` will silently reject these writes, returning empty arrays.

This is likely a **contributing factor** to the Marine Military Academy issue: the main thread sync could fail/timeout, the SW picks up the sync event, writes with the anon key, gets `200 []` back (RLS blocks it), but still marks it as synced locally.

### Gap 3: No Post-Sync Verification in Service Worker

The main thread now does a post-transaction verification read (checking the record exists on the server after sync). The service worker has no such check -- it trusts that if `syncStampResponse.ok` is true, the sync succeeded. But as noted in Gap 1, `ok` can be true with 0 rows affected.

### Gap 4: Service Worker PATCH Can Silently Affect 0 Rows

Lines 133-144 and 158-169 in `sw-sync.js` use `PATCH` with `?id=eq.{id}` filter. If the record doesn't exist on the server yet (new record created offline), PATCH returns `200 []` -- it matches 0 rows and updates nothing. The SW then proceeds to upsert children and mark as synced, creating orphaned child records with no parent.

The main-thread code handles this via `upsert` (which creates if not exists). The SW uses `PATCH` (which only updates existing records).

---

### Proposed Fixes

**File: `public/sw-sync.js`**

1. **Add response body verification to all PATCH and upsert calls**: After each `fetch()`, parse the JSON response and verify at least 1 row was returned. If 0 rows, throw an error instead of continuing.

2. **Add post-sync verification read**: After the final sync-stamp PATCH, do a GET to verify the record exists on the server with a non-null `synced_at`.

3. **Switch inspection parent write from PATCH to POST+upsert**: Use `POST` with `Prefer: resolution=merge-duplicates` (same as `upsertRelatedData`) instead of `PATCH` for the parent record, so new records created offline are properly inserted.

**Changes are strictly additive and defensive:**
- No local data is modified or deleted
- No existing protections are removed
- The only behavioral change: SW sync attempts that silently wrote 0 rows will now correctly fail and leave the record as "unsynced" for retry by the main thread

### Files to Modify

| File | Change |
|------|--------|
| `public/sw-sync.js` | Add row-count verification to all fetch responses; add post-sync verification read; switch parent PATCH to upsert for new records |

### What Stays Unchanged

- All main-thread sync code (already fixed)
- All IndexedDB data on the laptop
- Triple-Copy Backup, Emergency Save, WAL, regression guards
- No destructive operations added

