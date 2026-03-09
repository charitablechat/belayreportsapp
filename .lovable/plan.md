

# Add Facility & User Columns to Cloud Backup Snapshots Table

## What Changes

**1. Update `fetchCloudSnapshots()` in `src/lib/cloud-backup.ts`**
- Add `user_id` and `snapshot_data` to the select query (currently only metadata is fetched)
- Extract facility from `snapshot_data.parent.organization` (or `.location` / `.site` as fallback)
- Look up user names via the existing `getCachedProfile` pattern (same as `fetchAllCloudSnapshots` already does)
- Return two new fields on `CloudBackupEntry`: `facility: string` and `user_name: string`

**2. Update `CloudSnapshotsPanel` in `src/components/admin/DataRecoveryTool.tsx`**

Desktop table — new column order:
`Type | Facility | User | Device | Sync | Last Saved | Actions`

Mobile card layout — add Facility and User rows to the detail section.

Apply glassmorphism styling to table headers and rows:
- Table wrapper: `border-white/10 bg-white/5 dark:bg-white/[0.02]`
- Header row: `bg-white/5 dark:bg-white/[0.03] backdrop-blur-sm`
- Cells: reduced padding, `text-xs font-mono` for data density

## Technical Details

### `cloud-backup.ts` changes (~lines 56-69, 12-19)

Extend `CloudBackupEntry` interface:
```typescript
export interface CloudBackupEntry {
  // ...existing fields...
  user_name: string;
  facility: string;
}
```

Update `fetchCloudSnapshots` to select `user_id, snapshot_data` alongside existing columns, then:
```typescript
// Extract facility from snapshot parent
const facility = row.snapshot_data?.parent?.organization 
  || row.snapshot_data?.parent?.location 
  || row.snapshot_data?.parent?.site 
  || 'N/A';

// Batch-fetch profiles (reuse existing pattern from fetchAllCloudSnapshots)
const profile = await getCachedProfile(row.user_id);
const userName = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') : 'Unknown';
```

### `DataRecoveryTool.tsx` CloudSnapshotsPanel changes (~lines 486-526)

Desktop table gets two new `<TableHead>` columns and corresponding `<TableCell>` entries. Mobile card layout gets two new detail rows. Glass styling applied to the table border/header.

## Scope
- 2 files modified: `src/lib/cloud-backup.ts`, `src/components/admin/DataRecoveryTool.tsx`
- No database changes
- No new dependencies

