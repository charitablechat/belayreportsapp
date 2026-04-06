

# Batch PDF Generation with Incremental Nightly Sync

## Overview

Two-phase approach:
1. **One-time backfill**: A new edge function generates PDFs for all existing completed reports and uploads them to a persistent `pdfs/` folder in the `database-backups` bucket.
2. **Nightly incremental**: The daily backup only generates PDFs for reports completed **that day**, uploads them to the same `pdfs/` folder, and the off-site sync replicates new files.

The key insight: PDFs live in a **persistent top-level folder** (`pdfs/inspections/`, `pdfs/trainings/`) rather than inside each `daily/{timestamp}/` folder. This way the off-site sync can check what already exists and only transfer new ones.

## Architecture

```text
database-backups/
├── pdfs/                          ← persistent, accumulates over time
│   ├── inspections/
│   │   ├── org_2026-01-15_abc.pdf
│   │   └── org_2026-03-20_def.pdf
│   └── trainings/
│       └── org_2026-02-10_ghi.pdf
├── daily/2026-04-06/              ← nightly snapshot
│   ├── backup.json.gz
│   ├── tables/
│   ├── reports/
│   └── manifest.json
```

## New Edge Function: `generate-backup-pdfs`

**Purpose**: Generates PDFs by calling existing `generate-inspection-pdf` and `generate-training-pdf` internally, then saves to `pdfs/{type}/{filename}.pdf` in the `database-backups` bucket.

**Modes**:
- `backfill` — Process ALL completed reports (one-time use). Processes in batches of 3 concurrent to stay within timeout.
- `incremental` — Only process reports where `updated_at` falls within the last 24 hours and status is `completed`. This is what the nightly backup calls.

**Logic**:
1. Query completed inspections/trainings (filtered by date in incremental mode)
2. For each report, check if `pdfs/{type}/{org}_{date}_{id}.pdf` already exists in storage — skip if so
3. Call the existing PDF generator via internal HTTP (`fetch` to same Supabase instance with service role key)
4. The existing generators save PDFs to `inspection-reports` bucket — download from there
5. Re-upload to `database-backups/pdfs/{type}/{filename}.pdf`
6. Return summary (generated count, skipped count, errors)

## Changes to Nightly Backup

**File: `scheduled-backup-notify/index.ts`**

Add a new step between denormalized reports (Step 3) and the combined backup (Step 4):

- Call `generate-backup-pdfs` with `{ mode: "incremental" }`
- Log how many new PDFs were generated
- Include PDF stats in the manifest and email

## Off-Site Sync Enhancement

**File: `sync-offsite-backup/index.ts`**

Currently syncs only `daily/{timestamp}/` folder. Add a second sync pass for the `pdfs/` folder:
- List all files in source `pdfs/` folder
- List all files in external `pdfs/` folder  
- Only upload files that don't exist externally (idempotent skip)
- This naturally handles the incremental model — new PDFs appear, old ones are already synced

## Config

**File: `supabase/config.toml`**

Add `[functions.generate-backup-pdfs]` with `verify_jwt = false` (called internally by service role).

## Email Template Update

Add a "PDFs Generated" stat to the backup notification showing how many new PDFs were created that night.

## Summary of Changes

| File | Change |
|------|--------|
| `supabase/functions/generate-backup-pdfs/index.ts` | **New** — orchestrator with backfill/incremental modes |
| `supabase/functions/scheduled-backup-notify/index.ts` | Add Step 3.5: call `generate-backup-pdfs` in incremental mode |
| `supabase/functions/sync-offsite-backup/index.ts` | Add second sync pass for persistent `pdfs/` folder |
| `supabase/config.toml` | Add function config entry |
| `supabase/functions/_shared/transactional-email-templates/backup-notification.tsx` | Add PDF count stat |

## Usage

1. **First time**: Manually trigger `generate-backup-pdfs` with `{ mode: "backfill" }` to generate all historical PDFs
2. **Every night**: The daily backup automatically calls it with `{ mode: "incremental" }` — only new reports get PDFs
3. **Off-site sync**: Automatically replicates the persistent `pdfs/` folder, skipping already-synced files

