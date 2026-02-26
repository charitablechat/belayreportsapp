

## Cloud Backup Snapshots -- Sync Local Backups to Central Database

### Overview

Add a new database table (`report_cloud_backups`) to store local backup snapshots centrally. This creates a "fourth copy" of report data that is accessible from any device, without interfering with the existing save/sync pipeline.

### How It Works

1. **After every successful local snapshot write**, a background task uploads the snapshot to the central database (fire-and-forget, non-blocking).
2. **The Data Recovery UI** gains a new "Cloud Backups" tab showing snapshots from all devices, allowing restore on any device.
3. **No interference with existing sync**: Cloud backups are a passive mirror of localStorage snapshots. They never overwrite primary data (IndexedDB or server tables). They are only used when the user explicitly clicks "Restore" from the recovery panel.

### Database Table

```text
report_cloud_backups
+-----------------+----------+---------------------------------------+
| Column          | Type     | Notes                                 |
+-----------------+----------+---------------------------------------+
| id              | uuid     | PK, default gen_random_uuid()         |
| user_id         | uuid     | NOT NULL, references auth.uid via RLS |
| report_type     | text     | 'inspection'|'training'|'daily_...'   |
| report_id       | text     | The report UUID (may be temp-)        |
| device           | text     | 'mobile' or 'desktop'                 |
| synced           | boolean  | Whether the report was synced at time  |
| snapshot_data   | jsonb    | Full parent + children + photoMeta    |
| snapshot_ts     | bigint   | Client-side timestamp (epoch ms)      |
| created_at      | timestamptz | Server insert time                 |
+-----------------+----------+---------------------------------------+
```

RLS: Users can only read/write their own rows. A unique constraint on `(user_id, report_type, report_id)` ensures one cloud backup per report per user (upserted on each save).

### Code Changes

| File | Change |
|------|--------|
| **New migration** | Create `report_cloud_backups` table with RLS policies |
| `src/lib/local-backup-ledger.ts` | Add `uploadSnapshotToCloud()` -- fire-and-forget upsert after each `saveReportSnapshot` call |
| `src/lib/local-backup-ledger.ts` | Add `fetchCloudSnapshots()` and `fetchCloudSnapshot()` for reading |
| `src/components/admin/DataRecoveryTool.tsx` | Add a "Cloud Backups" section showing remote snapshots with Restore/Download actions |
| `src/components/UserDataRecoverySheet.tsx` | Include the cloud backups panel alongside local snapshots |

### Safety Guarantees

- **Non-blocking**: The cloud upload runs as a fire-and-forget async call after the localStorage write. If it fails (offline, quota, network error), the local backup still exists. No user-facing error.
- **No interference with sync**: Cloud backups write to a completely separate table (`report_cloud_backups`). The existing sync pipeline (`inspections`, `trainings`, `daily_assessments`) is untouched.
- **No interference with emergency save**: The emergency save path writes to localStorage first, then optionally triggers the cloud upload. If the cloud upload hangs, it does not block the save.
- **Upsert-only**: Each report gets exactly one cloud backup row per user. No unbounded growth. Estimated max ~500KB per snapshot row.
- **LRU cleanup**: A database function or client-side limit caps cloud backups to the most recent 50 per user, auto-deleting the oldest synced ones.
- **Restore is explicit**: Cloud backups are never auto-applied. The user must click "Restore" in the recovery panel, which writes to IndexedDB (same as current local restore flow).

### Technical Details

**Upload function** (in `local-backup-ledger.ts`):
```typescript
async function uploadSnapshotToCloud(
  reportType: ReportType,
  reportId: string,
  snapshot: ReportSnapshot
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    await supabase.from('report_cloud_backups').upsert({
      user_id: user.id,
      report_type: reportType,
      report_id: reportId,
      device: snapshot.device,
      synced: snapshot.synced,
      snapshot_data: { parent: snapshot.parent, children: snapshot.children, photoMetadata: snapshot.photoMetadata },
      snapshot_ts: snapshot.ts,
    }, { onConflict: 'user_id,report_type,report_id' });
  } catch {
    // Silent failure -- local backup is the safety net
  }
}
```

Called at the end of `saveReportSnapshot()` as a non-awaited promise (fire-and-forget).

**Fetch function** (for recovery UI):
```typescript
export async function fetchCloudSnapshots(): Promise<CloudBackupEntry[]> {
  const { data } = await supabase
    .from('report_cloud_backups')
    .select('id, report_type, report_id, device, synced, snapshot_ts, created_at')
    .order('snapshot_ts', { ascending: false })
    .limit(50);
  return data ?? [];
}
```

