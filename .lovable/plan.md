

# Daily Backup Email with JSON + HTML Reports + Photo Backup Strategy

## The Key Insight

The HTML reports already embed all photos as Base64 `data:` URIs — they're fully self-contained. So including the HTML files in the email **is** backing up photos for completed reports. You'd have:

- **`backup.json.gz`** — all database tables (stripped of HTML blobs, ~1.6 MB compressed)
- **Individual `.html` files** — one per completed inspection, training, and daily assessment, each viewable offline with embedded photos

## The Problem

Resend has a **40 MB attachment limit**. The JSON backup alone is ~1.6 MB compressed, but each HTML report can be 1–5 MB (photos are Base64-encoded at ~1.33× original size). With dozens of completed reports, this will exceed 40 MB quickly.

## Proposed Approach: Two-Part Daily Email

### Part 1: Email Attachment (always fits)
- **`backup.json.gz`** — current database JSON, compressed (~1.6 MB) — same as today
- **New HTML reports only** — only reports generated or updated *since the last backup* (delta). Typically 0–3 reports per day, well within the 40 MB limit.

If the day's HTML reports + JSON exceed 35 MB, skip the HTML attachments and include only the JSON + a download link to the full archive in storage.

### Part 2: Full Archive in Storage (always available)
- Upload a ZIP to `database-backups/daily/{timestamp}/` containing ALL HTML reports
- Include a 7-day signed download link in the email

### Photo Backup (Raw Files)

For the raw photos in the 3 storage buckets (`inspection-photos`, `training-photos`, `daily-assessment-photos`), email is not viable. Options:

1. **Storage-to-storage sync (recommended)**: The daily backup function already uploads to the `database-backups` bucket. Add a step that copies all photos from the 3 source buckets into `database-backups/daily/{timestamp}/photos/`. This creates a redundant copy within your backend storage — not truly off-site, but protects against accidental deletion.

2. **Make.com webhook**: You already have `MAKE_WEBHOOK_URL` configured. After the backup completes, POST the signed download URL to Make.com, which can then download the archive and push it to Google Drive, Dropbox, or S3 — giving you a true off-site backup of everything.

3. **Manual "Download All Photos" button**: Add a button in the admin panel that triggers an edge function to ZIP all photos from the 3 buckets and provide a download link. This is on-demand, not automated.

## Implementation Plan

### Files Changed

1. **`supabase/functions/scheduled-backup-notify/index.ts`** — Rewrite to:
   - Stop stripping `latest_report_html` from the 3 report tables (fetch it separately)
   - Extract each report's HTML into a named `.html` file
   - Gzip the collection of new/updated HTML files + JSON into attachments
   - Upload the full set of ALL HTML reports as a ZIP to `database-backups` bucket
   - Add size check: if attachments exceed 35 MB, fall back to download-link-only
   - POST to `MAKE_WEBHOOK_URL` with the signed download URL for off-site archival

2. **`src/components/admin/DatabaseBackupsPanel.tsx`** — Minor text updates describing new archive contents

3. **`src/lib/full-backup.ts`** — Update download helper for `.zip` filenames

### Email Content Updates
- Subject includes report count: "Ropeworks Daily Backup — 2 new reports — April 3, 2026"
- Stats section adds: report count, new reports today, photo count
- Download button links to full archive ZIP in storage
- Attached: `backup.json.gz` + individual HTML files for that day's reports

## Technical Details

- HTML reports are named: `{type}/{Organization}_{Date}_{id-prefix}.html`
- "New since last backup" determined by comparing `latest_report_generated_at` against the previous backup timestamp from `backup_history`
- Edge function timeout risk is minimal — HTML extraction is just string operations, no photo downloads needed
- Make.com webhook is fire-and-forget (non-blocking POST at the end)

