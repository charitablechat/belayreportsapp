

# Upload Combined Backup to Storage for Off-Site Sync

## Current Gap

The daily backup pipeline creates a `backup.json.gz` containing ALL 40+ tables (profiles, organizations, users, reports, etc.) but it's **only attached to the email** — it's never uploaded to the `database-backups` storage bucket. Since the off-site sync copies everything in the daily folder from storage, the combined backup file is missing from the external Supabase.

The individual table JSONs and denormalized reports ARE uploaded and synced, but having the single combined archive in the off-site backup makes it a true complete, self-contained system backup.

## Change

**File: `supabase/functions/scheduled-backup-notify/index.ts`**

After gzip compressing the combined backup (around line 450), add an upload step to put `backup.json.gz` into `daily/${timestamp}/backup.json.gz` in the `database-backups` bucket — before the off-site sync runs.

This is a ~5-line addition. No other files need changes. The off-site sync will automatically pick up the new file since it syncs everything in the daily folder.

## Result

Every night, the external Supabase `ropeworks-backups` bucket will contain:
- `backup.json.gz` — complete system snapshot (all tables, all rows)
- Individual table `.json` files
- Denormalized per-report JSON files
- Raw photo blobs
- `manifest.json`

