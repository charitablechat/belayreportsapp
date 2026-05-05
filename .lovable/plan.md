# Reclaim 22 GB of TOAST bloat on `audit_logs`

## Context

Earlier cleanup deleted ~111k bulky audit-log payload rows, but the table's **TOAST segment is still 22 GB** because regular autovacuum only marks dead pages as reusable — it does not return space to the OS. Only `VACUUM FULL` rewrites the table and releases disk back.

The previous attempt failed because `VACUUM FULL` needs roughly the table's own size in free disk to rewrite it (~22 GB), and only ~10 GB was free.

## Your part (do this first)

1. In the Cloud Advanced settings screen, set **New disk size (GB) → 70 → Increase disk size**.
2. Wait for the resize to complete (a few minutes; the UI will show when it's done). Disk can only ever go up, so 70 GB is the long-term ceiling.

## My part (after resize finishes — you tell me to go)

1. Run `VACUUM (FULL, ANALYZE) public.audit_logs`.
   - Takes 15–45 minutes.
   - Locks the table for writes during that window. Audit writes are async (fire-and-forget from triggers) so users see no impact; any audit rows queued during the lock just land after it finishes.
   - No other tables touched.
2. Re-query sizes and report back:
   - `audit_logs` total: **22 GB → ~200 MB** expected.
   - Database total: **25 GB → ~3 GB** expected.
   - Disk usage: **28.83 GB → ~6 GB out of 70 GB** (~9% used) expected.

## What this does NOT do

- Does not delete any audit rows beyond what was already cleaned.
- Does not touch user data, photos, reports, backups, or storage buckets.
- Does not change any application code.
- Does not affect the nightly retention cron that prevents this from recurring.

## If something goes wrong

`VACUUM FULL` is transactional — if it fails partway (e.g. unexpected disk pressure), the original table is left intact and no data is lost. Worst case: we're back where we started and try again with more headroom.

Reply "go" once the disk shows 70 GB and I'll run the vacuum.
