
# Root Cause: Why Twin Cedars Shows "Incomplete" on Mobile

## The Bug

The `synced_at` column for Twin Cedars is **NULL on the server**:

```text
Server state:
  id:         ac29f491-...
  status:     completed
  synced_at:  NULL        <-- this is the problem
  updated_at: 2026-02-07 22:14:34
```

This happens because the **web app saves directly to the database** (via Supabase SDK), which never sets `synced_at`. Only the mobile sync system sets `synced_at` after a successful push.

## The Chain of Failure

1. Report is completed on the **web app** -- saved to Supabase with `synced_at: NULL`
2. Dashboard on mobile loads server data and calls `saveInspectionOffline(inspection)` -- this saves the server record **as-is** into IndexedDB, including `synced_at: NULL`
3. User opens the report on mobile. The form loads IndexedDB data first, then fetches server data
4. The `localIsNewer` guard checks: `!offlineData.synced_at` -- this is `true` because `synced_at` is NULL
5. Guard concludes "local has unsynced changes" and **skips the server data**, preserving the stale local copy
6. The stale local copy still has `status: incomplete` from before the web completed it

The `localIsNewer` guard was designed to protect offline edits from being overwritten, but it has a blind spot: **it treats server-sourced data cached with `synced_at: NULL` as "local unsynced changes."**

## Fix

When the Dashboard caches server data into IndexedDB, stamp it with `synced_at = now()`. Data that came FROM the server IS synced by definition.

### File: `src/pages/Dashboard.tsx`

In `loadInspections` (~line 361), `loadTrainingReports`, and `loadDailyAssessments` -- where `saveXxxOffline` is called with network data:

```typescript
// BEFORE (saves server record as-is, with synced_at: null)
Promise.all(networkData.map(inspection => saveInspectionOffline(inspection)))

// AFTER (stamp synced_at so localIsNewer guard knows this is server data)
const now = new Date().toISOString();
Promise.all(networkData.map(inspection => 
  saveInspectionOffline({ ...inspection, synced_at: inspection.synced_at || now })
))
```

Apply the same pattern to:
- `loadTrainingReports` -- `saveTrainingOffline` call
- `loadDailyAssessments` -- `saveDailyAssessmentOffline` call

### File: `src/pages/InspectionForm.tsx` (line 884)

Same fix in the form's server cache write (the `else` branch when server data IS current):

```typescript
// BEFORE
saveInspectionOffline(data).catch(...)

// AFTER  
saveInspectionOffline({ ...data, synced_at: data.synced_at || new Date().toISOString() }).catch(...)
```

Apply to `TrainingForm.tsx` and `DailyAssessmentForm.tsx` at their equivalent cache lines.

### Why This Is Safe

- Only sets `synced_at` when it's currently NULL and the data came from the server
- If `synced_at` is already set, it's preserved as-is
- Local edits made offline will update `updated_at` without touching `synced_at`, so the `updated_at > synced_at` comparison still correctly identifies true local changes

### No database migration needed.

## Verification

1. After the fix, force-refresh the mobile dashboard (pull-to-refresh or Force Sync)
2. Twin Cedars should now show "completed" on mobile
3. Opening the report should display the server's completed data, not stale local data
