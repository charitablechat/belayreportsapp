

## Add Sync Path Tracking for Diagnostics

Track which sync path (main thread vs service worker) successfully synced each report, making future issues like the Marine Military Academy incident diagnosable at a glance.

### Approach

Add a `last_sync_source` text column to the three parent report tables. Each sync path stamps its identity when it sets `synced_at`, giving you a permanent record of how each report was last synced.

### Changes

**1. Database Migration** -- Add `last_sync_source` column

Add a nullable `text` column `last_sync_source` to `inspections`, `trainings`, and `daily_assessments`. Also add it to the `update_updated_at_column` exclusion list so it doesn't bump `updated_at` when only the source tag changes.

```sql
ALTER TABLE inspections ADD COLUMN last_sync_source text;
ALTER TABLE trainings ADD COLUMN last_sync_source text;
ALTER TABLE daily_assessments ADD COLUMN last_sync_source text;
```

Update `update_updated_at_column()` function to exclude `last_sync_source` from the comparison (same as `synced_at`, `last_opened_at`, etc.) so writing it doesn't trigger a new `updated_at` and cause a re-sync loop.

**2. Main Thread** -- `src/lib/atomic-sync-manager.ts`

In the final sync step for each report type (inspections line 535, trainings line 1239, daily assessments line 1878), add `last_sync_source: 'main_thread'` to the data payload:

```typescript
// Before:
data: { synced_at: new Date().toISOString() },

// After:
data: { synced_at: new Date().toISOString(), last_sync_source: 'main_thread' },
```

Three small edits, one per report type.

**3. Service Worker** -- `public/sw-sync.js`

In the sync stamp PATCH for each report type (inspections line 176, trainings line 457, daily assessments line 586), add `last_sync_source: 'service_worker'` to the JSON body:

```javascript
// Before:
body: JSON.stringify({ synced_at: now, updated_at: now })

// After:
body: JSON.stringify({ synced_at: now, updated_at: now, last_sync_source: 'service_worker' })
```

Three small edits, one per report type.

### How to Use

After deployment, you can query any report to see how it was last synced:

- `last_sync_source = 'main_thread'` -- synced by the authenticated main app (reliable path)
- `last_sync_source = 'service_worker'` -- synced by the SW background process (uses anon key, higher risk)
- `last_sync_source IS NULL` -- never synced, or synced before this feature was added

This would have immediately revealed the Marine Military Academy issue: the report would show `last_sync_source = 'service_worker'`, confirming the SW was the path that falsely marked it as synced.

### Files to Modify

| File | Change |
|------|--------|
| Database migration | Add `last_sync_source` column to 3 tables, update trigger exclusion |
| `src/lib/atomic-sync-manager.ts` | Add `last_sync_source: 'main_thread'` to 3 final sync steps |
| `public/sw-sync.js` | Add `last_sync_source: 'service_worker'` to 3 sync stamp PATCHes |

### What Stays Unchanged

- No changes to sync logic, data flow, or error handling
- No changes to IndexedDB or local storage
- Column is nullable so existing records are unaffected
- The `update_updated_at_column` trigger exclusion prevents re-sync loops

