

# Fix: Full Backup of Every Report (JSON + HTML)

## The Problem

The backup function looks for `latest_report_html` on each record, but **13 inspections, 1 training, and 2 daily assessments** that are completed have no HTML stored. These reports were completed before the "Latest Pointer" sync system was added, so their HTML was never saved back to the database. The backup correctly skips them because there's nothing to attach.

## The Fix (Two Parts)

### Part 1: Generate missing HTML at backup time

Modify the `scheduled-backup-notify` edge function to detect completed records where `latest_report_html IS NULL`, and for each one, call the existing `generate-inspection-html` / `generate-training-html` / `generate-daily-assessment-html` edge functions to produce the HTML, then store it back on the record. This is a one-time catch-up that runs before the attachment logic.

This approach:
- Uses the same HTML generation logic the app already uses
- Stores the result so future backups don't need to regenerate
- Happens server-side with `service_role` auth, no user interaction needed

### Part 2: Simplify the backup flow

Clean up the function to remove the delta/new tracking complexity. Every backup simply:
1. Fetches all tables → builds `backup.json.gz`
2. Generates any missing HTML reports (catch-up)
3. Collects ALL `latest_report_html` as individual `.html` attachments
4. If total size ≤ 35 MB → attach everything to email
5. If too large → attach only JSON, include download link
6. Upload everything to storage + send to Make.com webhook

### Files Modified

1. **`supabase/functions/scheduled-backup-notify/index.ts`**
   - Add a `generateMissingReports()` step that calls the 3 HTML generation edge functions for any completed record missing HTML
   - Remove `lastBackupAt` / `isNew` delta tracking — no longer needed
   - Simplify `HtmlReport` interface and extraction logic

### Technical Details

- The HTML generation functions are called via `fetch()` to the Supabase edge function URL with service role auth
- Each call is: `POST /functions/v1/generate-inspection-html` with `{ inspectionId: "..." }`
- Similar pattern for trainings (`trainingId`) and daily assessments (`assessmentId`)
- The generation functions already store the result in `latest_report_html`, so no extra write needed
- To avoid timeout issues with many missing reports, process in batches of 5 with sequential calls

