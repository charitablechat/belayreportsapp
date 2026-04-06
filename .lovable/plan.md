

# Add Daily Assessments to Backup PDF Pipeline

## Problem
The `generate-backup-pdfs` orchestrator only processes inspections and trainings. Completed daily assessments are missing from the rendered-report backups.

## Approach
Use the existing `generate-daily-assessment-html` function to produce self-contained HTML reports (with embedded Base64 photos and inline CSS) and store them alongside the PDFs. These HTML files are fully portable — openable and printable from any browser, even offline.

No new PDF generator needs to be built. The HTML output is functionally equivalent for backup/archival purposes.

## Technical Changes

| File | Change |
|------|--------|
| `supabase/functions/generate-daily-assessment-html/index.ts` | Add service-role auth bypass (same pattern as inspection/training PDF generators) |
| `supabase/functions/generate-backup-pdfs/index.ts` | Add daily assessment query + job type; call `generate-daily-assessment-html` with service-role auth; download the HTML from `inspection-reports` bucket; upload to `database-backups/pdfs/daily-assessments/{org}_{date}_{id}.html` |

## Changes in Detail

**1. `generate-daily-assessment-html/index.ts`** — Add ~10 lines near the auth section:
- Check if the Bearer token matches `SUPABASE_SERVICE_ROLE_KEY`
- If so, skip user auth and proceed directly (same pattern already used in the inspection/training PDF generators)

**2. `generate-backup-pdfs/index.ts`**:
- Add a third query for `daily_assessments` table (status = completed, deleted_at is null, with incremental date filter)
- Add `"daily_assessment"` to the Job type union
- For daily assessment jobs, call `generate-daily-assessment-html` with `{ assessmentId: job.id }`
- The HTML generator uploads to `inspection-reports` bucket and returns `{ htmlUrl }` — download from there
- Upload to `database-backups/pdfs/daily-assessments/{org}_{date}_{id}.html`
- Storage path uses `pdfs/daily-assessments/` to keep it alongside inspection/training PDFs

## Storage Layout After Change

```text
database-backups/
├── pdfs/
│   ├── inspections/     ← PDF files
│   ├── trainings/       ← PDF files
│   └── daily-assessments/ ← HTML files (self-contained, print-ready)
```

## Off-Site Sync
No changes needed — `sync-offsite-backup` already syncs everything under `pdfs/` recursively, so daily assessment HTML files will be picked up automatically.

## Backfill
After deploying, run `generate-backup-pdfs` with `{ "mode": "backfill" }` once more to pick up all historical daily assessments. Existing inspection/training PDFs will be skipped (already present).

