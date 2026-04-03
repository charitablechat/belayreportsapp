

# Remove HTML Catch-up Generation from Backup

## What Changes

**One file modified:** `supabase/functions/scheduled-backup-notify/index.ts`

1. **Delete the `generateMissingReports()` function** (lines ~162–298) — the entire catch-up mechanism that calls the HTML generation edge functions for legacy records.

2. **Remove Step 2** (lines ~475–477) — the call to `generateMissingReports()` during the backup flow.

3. The backup will simply use whatever `latest_report_html` already exists on each record. Records without HTML will be skipped (no HTML attachment generated for them), but their data is still fully captured in `backup.json.gz`.

## What Stays the Same

- Full JSON export of all 40+ tables
- All existing HTML reports attached as individual `.html` files
- 35 MB safety valve with fallback to download link
- Storage upload + Make.com webhook
- Email delivery via Resend

