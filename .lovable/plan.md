

# Replace HTML Reports with User-Friendly Backup Format

## Problem

The daily backup pipeline currently extracts `latest_report_html` from every inspection, training, and daily assessment, then uploads each as individual `.html` files to storage, attaches them to email, and syncs them off-site. This is slow, bloats the archive, and doesn't serve your needs.

## What stays the same

- Compressed `backup.json.gz` with all table data (already strips HTML blobs) — emailed and synced off-site
- Individual table JSON files uploaded to `database-backups` storage
- Photo storage backup
- Off-site sync to external Supabase
- Make.com webhook
- Manifest file

## What gets removed

- Step 3 entirely: no more `extractHtmlReports()` call
- No more uploading individual `.html` files to storage
- No more attaching HTML reports to email
- No more archive size calculations based on HTML content
- Email template simplified (no "HTML Reports" row, no attachment size warnings)

## Replacement options for external Supabase

Here are three ideas for what to send instead — all are more portable and queryable than HTML:

### Option A: Denormalized JSON reports (recommended)
One JSON file per inspection/training/assessment with all child table data joined inline. Example structure:
```json
{
  "type": "inspection",
  "id": "abc-123",
  "organization": "Adventure Park",
  "inspection_date": "2026-04-01",
  "systems": [...],
  "equipment": [...],
  "standards": [...],
  "photos": [{ "id": "...", "caption": "...", "storage_path": "..." }],
  "summary": {...}
}
```
These are human-readable, machine-queryable, and could be used to regenerate HTML/PDF on demand later. Uploaded as `reports/inspections/org_date_id.json`.

### Option B: CSV exports per table
Each table exported as a `.csv` file alongside the JSON. Opens directly in Excel or Google Sheets. Simple but loses the relational structure between parent/child tables.

### Option C: Combined summary spreadsheet
A single multi-sheet Excel file (using a Deno-compatible library) with one sheet per table. Most "spreadsheet friendly" but adds a dependency and complexity.

## Recommended approach: Option A

Denormalized JSON reports give you the best of both worlds — human-readable, machine-parseable, and contain everything needed to reconstruct any report format later. They're also much smaller than HTML (no embedded base64 photos, no CSS/markup).

## Technical changes

| File | Change |
|------|--------|
| `scheduled-backup-notify/index.ts` | Remove `extractHtmlReports()` and all HTML-related steps. Add new `buildDenormalizedReports()` that joins parent + child tables into per-report JSON files. Simplify email template. |
| `sync-offsite-backup/index.ts` | No changes needed — it already syncs whatever is in the backup folder |
| `DatabaseBackupsPanel.tsx` | Minor: remove any HTML report count references if displayed |
| Email template | Simplified — no HTML report count/attachment logic, just JSON backup stats |

## Impact

- Faster daily backups (no HTML extraction loop)
- Smaller email attachments (just the gzipped JSON)
- Smaller storage footprint per backup
- External Supabase gets structured, queryable data instead of opaque HTML blobs
- HTML reports can still be generated on-demand via existing edge functions when needed

