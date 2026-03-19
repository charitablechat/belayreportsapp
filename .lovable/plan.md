

## Full Database Backup — Server-Side Storage with Optional Download

### Overview
A scheduled full database export that stores the backup as a JSON file in a dedicated storage bucket on the server. When the backup runs (weekly), super admins see a prompt asking if they also want to download the file locally. Manual backup and restore are always available.

### Architecture

```text
┌─────────────────────────┐
│  pg_cron (weekly)       │──▶ export-full-backup edge fn
└─────────────────────────┘           │
                                      ▼
                              Query all tables
                                      │
                                      ▼
                           Upload JSON to Storage
                           (database-backups bucket)
                                      │
                                      ▼
                           Return storage path + metadata
                                      
┌─────────────────────────┐
│  Super Admin Dashboard  │──▶ On mount: check last backup age
│                         │   If > 7 days: show toast prompt
│                         │   "Download latest backup?"
│                         │   [Download] [Dismiss]
│                         │
│  Manual controls:       │
│  • [Backup Now] button  │
│  • [View Backups] list  │──▶ Lists files from storage bucket
│  • [Restore] upload     │──▶ restore-full-backup edge fn
└─────────────────────────┘
```

### Changes

| File | What |
|------|------|
| **Migration SQL** | Create `database-backups` private storage bucket with RLS (super admin only). Create `backup_history` table to track backup metadata (id, file_path, file_size, table_counts, created_at, created_by). |
| **`supabase/functions/export-full-backup/index.ts`** | New edge function. Verifies super admin via `getClaims()`. Queries all core tables (profiles, organizations, org_members, user_roles, inspections + 6 child tables, trainings + 7 child tables, daily_assessments + 6 child tables, user_field_history, audit_logs, form config tables). Builds JSON payload with table counts metadata. Uploads to `database-backups` bucket as `backup-{timestamp}.json`. Inserts row into `backup_history`. Returns file path. |
| **`supabase/functions/restore-full-backup/index.ts`** | New edge function. Accepts either a storage file path (to restore from server) or uploaded JSON body. Validates structure. Upserts records table-by-table in dependency order: orgs → profiles → reports → children. Super admin only. |
| **`supabase/config.toml`** | Add `verify_jwt = false` for both new functions. |
| **`src/lib/full-backup.ts`** | New client helper. `triggerFullBackup()` — calls export edge fn, returns metadata. `downloadBackupFile(filePath)` — fetches from storage, triggers browser download via `saveToDevice`. `listServerBackups()` — queries `backup_history` table. `restoreFromServer(filePath)` — calls restore edge fn with a storage path. `restoreFromFile(file)` — reads uploaded JSON, calls restore edge fn with body. |
| **`src/pages/SuperAdminDashboard.tsx`** | Add "Database Backups" section: backup-now button, backup history list with download buttons, restore-from-file upload. On mount, check `backup_history` for latest backup age; if > 7 days, show toast with "Download latest backup?" prompt. |

### Tables Exported
- `profiles`, `organizations`, `organization_members`, `user_roles`
- `inspections`, `inspection_systems`, `inspection_equipment`, `inspection_standards`, `inspection_photos`, `inspection_ziplines`, `inspection_summary`
- `trainings`, `training_systems`, `training_equipment`, `training_photos`, `training_operating_systems`, `training_delivery_approaches`, `training_verifiable_items`, `training_immediate_attention`, `training_systems_in_place`, `training_summary`
- `daily_assessments`, `daily_assessment_beginning_of_day`, `daily_assessment_end_of_day`, `daily_assessment_environment_checks`, `daily_assessment_equipment_checks`, `daily_assessment_operating_systems`, `daily_assessment_structure_checks`, `daily_assessment_photos`
- `user_field_history`, `global_field_history`, `audit_logs`

### Auto-Backup Schedule
- A `pg_cron` job runs weekly, calling the `export-full-backup` edge function via `pg_net`
- The backup is stored server-side automatically — no browser needed
- When a super admin opens the dashboard and the latest backup is older than 7 days (or a new one just completed), a toast prompt asks: "A new backup is available. Download it?" with Download/Dismiss actions

### Restore Safety
- Restore uses `upsert` (not truncate) — existing records not in the backup are preserved
- Confirmation dialog shows record counts per table and backup timestamp
- Super admin only, verified server-side

