

# Off-Site Backup to AWS S3 + External Supabase

## Overview

Add a new step to the daily automated backup pipeline that pushes the complete backup archive (JSON, HTML reports, and photos) to **both** an external AWS S3 bucket and an external Supabase project. This runs automatically after the existing backup completes, with a manual trigger option in the admin UI.

## Prerequisites

1. **AWS S3 Connector** — needs to be connected via Lovable's built-in AWS S3 connector (handles auth automatically)
2. **External Supabase credentials** — the user provides their external Supabase project URL and service role key as secrets

## Architecture

```text
Daily Backup Pipeline (existing)
  ├─ Step 1: Export all tables → database-backups bucket
  ├─ Step 2: Backup photos → database-backups bucket  
  ├─ Step 3: Extract HTML reports → database-backups bucket
  ├─ ...existing email + Make.com steps...
  │
  └─ NEW Step (after manifest upload, before email):
       ├─ Push backup.json.gz → AWS S3  (via connector gateway signed URL)
       ├─ Push backup.json.gz → External Supabase storage
       ├─ Push manifest.json → both destinations
       └─ Report results in email + webhook payload
```

## Implementation Plan

### 1. Connect AWS S3 Connector
Use the built-in AWS S3 connector to link an S3 bucket to the project. This provides `AWS_S3_API_KEY` automatically. Write scope is required for uploads.

### 2. Add External Supabase Secrets
Two new secrets:
- `EXTERNAL_SUPABASE_URL` — the external project's API URL
- `EXTERNAL_SUPABASE_SERVICE_KEY` — the external project's service role key

### 3. New Edge Function: `sync-offsite-backup`
**File:** `supabase/functions/sync-offsite-backup/index.ts`

A dedicated function that receives a backup path (e.g. `daily/2026-04-05T...`) and pushes key files to both destinations.

**What gets synced:**
- `backup.json.gz` (the combined compressed database dump, ~2-10MB)
- `manifest.json` (metadata about the backup)
- HTML report files (from `daily/{ts}/reports/`)
- Photo files (from `daily/{ts}/photos/`) — these are the largest, processed in batches

**AWS S3 flow:**
1. For each file, request a signed upload URL via the connector gateway (`POST /api/v1/sign_storage_url?provider=aws_s3&mode=write`)
2. Download file from the `database-backups` bucket
3. Upload to S3 via the signed URL (`PUT`)
4. Track success/failure per file

**External Supabase flow:**
1. Create a Supabase client using the external URL + service key
2. Upload each file to a `ropeworks-backups` bucket on the external project
3. Uses the same batched concurrency (5 at a time) as existing photo backup

**Safety features:**
- 5-minute timeout safety valve
- Per-file error tracking (continues on individual failures)
- Idempotent — checks if destination file exists before uploading
- Graceful degradation — if one destination fails, the other still proceeds

### 4. Modify: `scheduled-backup-notify/index.ts`
Add a new step (after Step 6 manifest upload, before Step 8 email) that calls `sync-offsite-backup` internally, similar to how `backup-photo-storage` is called.

- Pass the backup timestamp so it knows which folder to sync
- Capture results (files synced, errors, per-destination status)
- Add off-site sync stats to the email HTML and Make.com webhook payload
- Non-blocking: if off-site sync fails entirely, the backup still succeeds

### 5. Modify: `DatabaseBackupsPanel.tsx`
Add a "Sync Off-Site" button per backup row that manually triggers `sync-offsite-backup` for that backup path. Shows sync status (syncing spinner, success checkmark, error badge).

### 6. Email & Webhook Enhancements
Add an "Off-Site Sync" section to the backup email:
- AWS S3: ✅ 47 files synced (12.3 MB) or ❌ Failed
- External Supabase: ✅ 47 files synced or ❌ Failed

Add `offsite_sync` object to the Make.com webhook payload.

## Summary of Changes

| File | Change |
|------|--------|
| `supabase/functions/sync-offsite-backup/index.ts` | New — pushes backup files to S3 + external Supabase |
| `supabase/functions/scheduled-backup-notify/index.ts` | Call sync-offsite-backup, add results to email/webhook |
| `src/components/admin/DatabaseBackupsPanel.tsx` | Add manual "Sync Off-Site" button |
| Secrets | `EXTERNAL_SUPABASE_URL`, `EXTERNAL_SUPABASE_SERVICE_KEY` |
| Connector | AWS S3 connector (write scope) |

## Setup Steps for You

1. I'll prompt you to connect the AWS S3 connector (select your bucket, enable write access)
2. I'll ask you to provide two secrets for your external Supabase project
3. Your external Supabase project needs a storage bucket called `ropeworks-backups` (I'll provide the SQL to create it)
4. Your S3 bucket needs CORS configured to allow uploads from the edge function (I'll provide the config)

