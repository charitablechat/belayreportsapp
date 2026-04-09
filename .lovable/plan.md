

# Fix: Nightly Backup Triggering Report "Completion" Side Effects

## Root Cause

The `generate-backup-pdfs` edge function (called by the nightly `scheduled-backup-notify`) calls the **live report generation functions** (`generate-inspection-pdf`, `generate-training-pdf`) to produce backup copies of rendered reports. These generation functions have a critical side effect:

**They upsert into `inspection_reports` and `training_reports` tables**, which:
1. Overwrites `generated_by` with `null` (no user in service-role context)
2. Bumps `version` via the `increment_*_report_version` trigger
3. Updates `generated_at` to `NOW()`
4. Writes new PDF files to the `inspection-reports` storage bucket, overwriting any existing ones

This means every nightly backup **modifies production database records and storage** as a side effect of what should be a read-only operation. Reports that already had PDFs get re-generated, their metadata is overwritten, and version numbers inflate.

## Solution

Rewrite `generate-backup-pdfs` to be a **copy-only** operation — never call the generation functions. Instead:

1. For each completed report, check if a rendered file already exists in the `inspection-reports` bucket
2. If yes → download it and copy to the `database-backups/pdfs/` folder
3. If no → skip it (count as `no_source`, don't generate)

This eliminates all database writes and storage overwrites from the backup process.

## Technical Details

### File: `supabase/functions/generate-backup-pdfs/index.ts`

Replace the current flow (call generation function → find source → download → upload to backup) with:

```
For each completed report:
  1. Look up existing source file:
     - Inspections: query inspection_reports.pdf_url
     - Trainings: list inspection-reports/training-reports/ for matching file
     - Daily Assessments: list inspection-reports/html-reports/ for matching file
  2. If source exists → download from inspection-reports → upload to database-backups/pdfs/
  3. If no source → increment no_source counter, skip
```

Remove all `fetch()` calls to generation functions. The function becomes purely read-from-source, write-to-backup.

### Result interface update

Replace `generated` counter with `copied` and add `no_source` to track reports that had no rendered file available.

### No other files change

The `scheduled-backup-notify` function already handles `pdfBackupResult` generically — it just reads the response fields. The email template references `pdfBackup.generated` which we'll rename to `pdfBackup.copied`, requiring a minor update to the email HTML builder in `scheduled-backup-notify/index.ts`.

### Files Modified
- `supabase/functions/generate-backup-pdfs/index.ts` — rewrite to copy-only (no generation calls)
- `supabase/functions/scheduled-backup-notify/index.ts` — update email template field name (`generated` → `copied`)

