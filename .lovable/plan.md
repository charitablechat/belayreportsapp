

## Add "All User Snapshots" Panel to Admin Data Recovery

### What This Adds
A new panel in the Super Admin Data Recovery Tool that queries ALL cloud backup snapshots across ALL users, grouped by user name. This gives admins a single place to find and restore any user's data.

### How It Works

1. **Database: Add RLS policy for super admin access**
   - Add a SELECT policy on `report_cloud_backups` so super admins can read all rows (currently users can only see their own)
   - No schema changes needed — the table already has all the data

2. **New query function: `fetchAllCloudSnapshots()`**
   - Joins `report_cloud_backups` with `profiles` to get user names
   - Returns snapshots grouped by user, sorted newest-first
   - Only callable by super admins (RLS enforces this)

3. **New UI panel: `AllUserSnapshotsPanel`**
   - Added to the admin `DataRecoveryTool` as a new tab/section
   - Shows snapshots grouped under collapsible user headers (e.g., "John Smith — 4 snapshots")
   - Each snapshot shows: report type, organization, device, timestamp, sync status
   - Actions: Restore (pushes data back to the server tables), Export JSON, View diff (future)

4. **Restore to server (not just local)**
   - Unlike the current restore which writes to IndexedDB, admin restores should write directly back to the database tables (upsert parent + delete/re-insert children)
   - This uses the same pattern as the proposed admin edit snapshot restore

### What Does NOT Change
- Regular users still only see their own snapshots in the user-facing Data Recovery sheet
- The existing Local Snapshots and Cloud Snapshots panels remain unchanged
- No changes to how snapshots are created or uploaded

### Technical Details

| Change | File(s) |
|--------|---------|
| RLS policy: super admin SELECT on `report_cloud_backups` | New SQL migration |
| `fetchAllCloudSnapshots()` with profile join | `src/lib/cloud-backup.ts` |
| `AllUserSnapshotsPanel` component | `src/components/admin/DataRecoveryTool.tsx` |
| Server-side restore utility | `src/lib/cloud-backup.ts` (new function) |

### UI Layout

```text
Data Recovery Tool (Super Admin)
+------------------------------------------+
| [Local Snapshots]  [Cloud Snapshots]     |
| [All User Snapshots]  [IndexedDB]        |
+------------------------------------------+
| ALL USER SNAPSHOTS                       |
|                                          |
| > John Smith (4 snapshots)               |
|   - Inspection | Acme Corp | Feb 25      |
|   - Training | Acme Corp | Feb 24        |
|                                          |
| > Jane Doe (2 snapshots)                 |
|   - Daily Assessment | Beta Inc | Feb 23 |
+------------------------------------------+
```

### Risk Assessment
- **Zero risk to existing data**: Only adds a new RLS policy (SELECT) and a new UI panel
- **Security**: RLS ensures only super admins can see all snapshots; regular users are unaffected
- **Performance**: Query is limited to 100 rows with pagination possible later

