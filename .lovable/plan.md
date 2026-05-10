# Cut Cloud Burn — Retention Janitor

## Goal

Stop paying for ~12 GB of storage and 2.6 GB of DB that's mostly historical exhaust. Fixes the actual cost driver behind the recent $35–42 spikes.

## Current waste (from diagnostics)

| Source | Size | Issue |
|---|---|---|
| `database-backups` bucket | 7.3 GB / 7,801 objects | Never pruned — every daily + weekly backup kept forever |
| `cron.job_run_details` | 1.9 GB | Every cron tick (incl. 5s email poller) writes a row, never trimmed. 74% of DB. |
| `audit_logs` | 356 MB | No retention |
| `report_deleted_items` | 120 MB | Soft-deletes accumulate |
| `admin_edit_snapshots` | 97 MB | No retention |

## Plan

### 1. New `nightly-retention-janitor` cron — runs 04:00 ET daily

Single pg_cron job that runs four `DELETE` statements wrapped in their own savepoints so one failure doesn't block the others:

- **`cron.job_run_details`** — keep last 7 days (`WHERE end_time < now() - interval '7 days'`). Frees ~1.8 GB immediately. Postgres has a built-in helper `cron.purge_run_details()` we can call instead if available.
- **`audit_logs`** — keep last 90 days. Frees ~250 MB.
- **`admin_edit_snapshots`** — keep last 90 days. Frees ~70 MB.
- **`report_deleted_items`** — already has a 60-day retention contract per memory; verify the existing `cleanup-expired-deleted-records` cron is actually firing. If yes, leave alone.

### 2. Backup bucket retention — runs 04:15 ET daily

New edge function `prune-old-backups` (or extend `nightly-retention-cleanup` if it exists) that lists `database-backups` storage bucket and deletes objects following:

- Keep **last 30 daily** backups
- Keep **last 12 Sunday** (weekly) backups beyond that
- Delete everything else

Pruning ~7,700 of 7,801 objects → frees ~6+ GB. Function uses service role, called via webhook secret like the existing backup crons.

### 3. Verification queries (run once after first execution)

```sql
SELECT pg_size_pretty(pg_total_relation_size('cron.job_run_details'));
SELECT count(*), pg_size_pretty(sum(file_size_bytes)) FROM backup_history;
```

Plus a `SELECT name, count(*) FROM storage.objects WHERE bucket_id = 'database-backups'` before/after.

## Technical details

- Both crons go through `supabase--insert` (per project convention — they reference URLs/secrets, not migrations).
- Janitor SQL uses `DO $$ BEGIN ... EXCEPTION WHEN OTHERS THEN ... END $$` blocks per table so a single bad row doesn't abort the whole sweep.
- Backup pruner edge function:
  - Auth: webhook secret header (matches `export-full-backup` pattern)
  - Lists `database-backups` paginated (1000 at a time), groups by `created_at` parsed from filename, applies retention rules, batch `.remove([...])` calls.
  - Logs result to `backup_history` metadata or a new `backup_pruning_log` row (decide during impl).
- `verify_jwt = false` for the new edge function in `supabase/config.toml`.

## Out of scope

- Email queue cron (already discussed — 30s is fine, leaving alone).
- Compressing backups (would help but adds complexity; pruning gets us most of the win).
- Reducing daily-backup frequency (user wants daily backups; only changing retention).

## Expected impact

- **Storage**: ~12 GB → ~3 GB (75% reduction)
- **DB size**: 2.6 GB → ~0.5 GB (80% reduction) → smaller every future backup too
- **Monthly burn**: should drop the storage+DB component roughly in proportion. Won't fully know until the next billing cycle, but this targets the right line items.

## Rollback

If anything looks off after the first run:
- `cron.unschedule('nightly-retention-janitor')`
- `cron.unschedule('prune-old-backups')`

Deleted rows from `cron.job_run_details` and `audit_logs` are not recoverable, but they're operational logs — losing >7d / >90d of them is acceptable. Backup objects deleted from storage are gone permanently, which is why we keep 30 daily + 12 weekly as a safety margin (≈4+ months of recovery points).
