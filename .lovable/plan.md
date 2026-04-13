

# Trigger Off-Site Backup Sync

## Problem
The `sync-offsite-backup` edge function times out when called via the internal tool because it transfers many files between storage buckets and needs several minutes to complete. The tool's request timeout is shorter than the function's execution time.

## Solution
There are two approaches to get this done right now:

### Option A — Call the function from your browser console (fastest, no code change)
Open the **published app** at `https://ropeworks.lovable.app` and run this in the browser developer console (F12 → Console):

```javascript
const { data, error } = await window.__supabase.functions.invoke('sync-offsite-backup', {
  body: { backup_path: 'daily/2026-04-13T00-00-03-366Z' }
});
console.log(data, error);
```

If `window.__supabase` is not exposed, use:
```javascript
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
const sb = createClient('https://ssgzcgvygnsrqalisshx.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzZ3pjZ3Z5Z25zcnFhbGlzc2h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyMzM5NjksImV4cCI6MjA3NzgwOTk2OX0.buTFy44tZdRIlRSFIm5BqeOGb4nX3ARuHawWA9hZN54');
// You must be logged in as the backup admin for this to work
const { data, error } = await sb.functions.invoke('sync-offsite-backup', {
  body: { backup_path: 'daily/2026-04-13T00-00-03-366Z' }
});
console.log(data, error);
```

### Option B — Add a "Sync Now" button to the Admin Backups panel
I would add a button in the `DatabaseBackupsPanel` component that calls the `sync-offsite-backup` function for the latest backup entry. This gives you a permanent UI control.

### Recommendation
Option A gets you the sync right now with zero code changes. Option B adds the capability permanently. I can implement Option B after you confirm the sync worked.

