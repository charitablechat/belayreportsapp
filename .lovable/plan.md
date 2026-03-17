

## Fix Missing Facility Names in Cloud Backup Recovery

### Problem
The facility name is hardcoded as `'N/A'` in both `fetchCloudSnapshots()` and `fetchAllCloudSnapshots()` in `src/lib/cloud-backup.ts`. The metadata query intentionally excludes `snapshot_data` (to keep responses lightweight), but the facility/organization name lives inside `snapshot_data.parent.organization`.

### Solution
Add a dedicated `facility` column to the `report_cloud_backups` table, populated at upload time from `snapshot.parent.organization`. This avoids fetching the full