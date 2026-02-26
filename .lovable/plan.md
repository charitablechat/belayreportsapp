


## Remaining Gaps in the Sync Pipeline — ALL FIXED ✅

### Gap 1: Service Worker Has No Row-Count Verification ✅
**Fix:** Added `verifyResponseRows()` helper that parses JSON response and throws if 0 rows returned. Applied to all PATCH/upsert calls across inspections, trainings, and daily assessments.

### Gap 2: Service Worker Uses Anon Key Instead of User's JWT ✅ (mitigated)
**Fix:** Rather than implementing JWT passthrough (complex in SW context), the row-count verification from Gap 1 now catches RLS-blocked writes. The SW will correctly fail and leave records as "unsynced" for the main thread (which has the correct JWT) to retry.

### Gap 3: No Post-Sync Verification in Service Worker ✅
**Fix:** Added a GET verification read after every sync-stamp PATCH. Confirms the record exists on the server with a non-null `synced_at` before updating local IndexedDB.

### Gap 4: Service Worker PATCH Can Silently Affect 0 Rows ✅
**Fix:** Switched all parent record writes from PATCH to POST with `Prefer: resolution=merge-duplicates`, matching the upsert pattern used for child records. This handles offline-created records that don't exist on the server yet.

### Files Modified
| File | Change |
|------|--------|
| `public/sw-sync.js` | Added `verifyResponseRows()`, switched parent PATCH→POST+upsert, added post-sync GET verification |
