

# Fix PDF Backfill: Generate PDFs Instead of Just Copying

## Problem

The current `generate-backup-pdfs` function only looks for **already-existing** PDFs in the `inspection-reports` bucket. Since PDFs are generated on-demand when users view reports (and none have been generated yet for most reports), the backfill found 0 PDFs to copy — returning `no_pdf: 24`.

## Root Cause

- Inspection PDFs are stored at `inspection-{org}-{timestamp}.pdf` in the `inspection-reports` bucket
- Training PDFs are stored at `training-reports/training-report-{id}-{timestamp}.pdf`
- The `inspection_reports` and `training_reports` database tables track these, but both are empty — no PDFs have ever been generated
- The existing PDF generators (`generate-inspection-pdf`, `generate-training-pdf`) require a user JWT for auth + rate limiting, making them hard to call from a service-role context

## Solution

Rewrite `generate-backup-pdfs` to **generate PDFs directly** using the same jsPDF logic from the existing generators, but running with service-role privileges (no user auth needed). This avoids the auth/rate-limit issues of calling the existing functions via HTTP.

Specifically:
1. Import the same shared utilities (`training-formatter.ts`, `report-layout.ts`) used by the existing generators
2. For each completed report, fetch data directly with the service-role client, generate the PDF in-memory using jsPDF, and upload directly to `database-backups/pdfs/{type}/{filename}.pdf`
3. Skip the `inspection-reports` bucket entirely — write straight to the backup bucket

## Why not call the existing generators via HTTP?

- They require a real user JWT (not service-role)
- They have rate limiting (10/hour per user)
- They save to `inspection-reports` bucket and create DB records — we don't want side effects
- Calling 24+ functions sequentially via HTTP would likely timeout

## Technical Changes

| File | Change |
|------|--------|
| `supabase/functions/generate-backup-pdfs/index.ts` | Rewrite to inline the PDF generation logic (import jsPDF, fetch data with service role, generate PDF, upload to backup bucket) |

The function will:
1. Query all completed inspections and trainings (or just recent ones in incremental mode)
2. For each, fetch the full data (inspection + systems + equipment + standards + photos, or training + formatter)
3. Generate the PDF using jsPDF (reusing the same layout logic from the existing generators)
4. Upload to `database-backups/pdfs/inspections/{org}_{date}_{id}.pdf` or `pdfs/trainings/...`
5. Skip if the file already exists in the backup bucket

## Complexity Note

The inspection PDF generator is ~800 lines and the training one is ~750 lines. Rather than duplicating all that, the function will call the existing generators via internal HTTP **but with a bypass**: we'll modify the generators to accept a service-role key as auth (checking if the caller is service-role and skipping rate limiting). This is a much smaller change.

## Revised Approach (Minimal Changes)

**Option chosen**: Modify `generate-inspection-pdf` and `generate-training-pdf` to accept service-role auth (skip rate limiting + user check when called with service role key), then have `generate-backup-pdfs` call them via internal HTTP with the service role key.

| File | Change |
|------|--------|
| `generate-inspection-pdf/index.ts` | Add service-role auth bypass: if Authorization header contains the service role key, skip user auth and rate limiting |
| `generate-training-pdf/index.ts` | Same service-role auth bypass |
| `generate-backup-pdfs/index.ts` | Rewrite to call the PDF generators via internal `fetch()`, download the generated PDF from `inspection-reports` bucket, re-upload to `database-backups/pdfs/`, then clean up the temp file from `inspection-reports` |

## Flow

```text
generate-backup-pdfs (backfill)
  → for each completed inspection:
      → POST generate-inspection-pdf { inspectionId } with service-role auth
      → PDF saved to inspection-reports/{filename}
      → Download from inspection-reports
      → Upload to database-backups/pdfs/inspections/{org}_{date}_{id}.pdf
      → Delete temp file from inspection-reports (cleanup)
  → for each completed training:
      → POST generate-training-pdf { trainingId } with service-role auth
      → same download/upload/cleanup flow
```

After backfill completes, trigger `sync-offsite-backup` with `pdfs` folder to replicate to external Supabase.

