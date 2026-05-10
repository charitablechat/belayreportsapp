# Reduce Lovable Cloud Burn

## Goal

Cut baseline Cloud cost by eliminating wasteful background work. Primary win: stop polling an empty email queue every 5 seconds.

## Findings

- `process-email-queue` cron runs **every 5 seconds** → ~17,280 invocations/day even when both queues are empty (currently 0 messages in both `q_auth_emails` and `q_transactional_emails`).
- `daily-backup-8pm-et` cron has the **anon key hardcoded inline** instead of using `webhook_config` like every other cron.
- `weekly-full-database-backup` runs Sundays at 03:00 with no idempotency guard — if it fires twice (e.g. retry after a transient failure) it does a second full table scan and storage write.
- `backup_history` shows 0 rows in the last 7 days despite the weekly cron — worth a sanity check but not blocking.

## Changes

### 1. Slow the email queue poller (biggest impact)

Reschedule `process-email-queue` from `5 seconds` to `30 seconds`. Keeps email delivery feel near-instant for users (Auth emails are batched server-side anyway and 30s is well within tolerance) while cutting invocations **6×**: from ~17,280/day to ~2,880/day.

The existing SQL guard already short-circuits when both queues are empty, so this purely reduces wakeup overhead.

### 2. Move hardcoded anon key to `webhook_config`

Rewrite the `daily-backup-8pm-et` cron to look up the webhook secret from `webhook_config` (matching the pattern used by `weekly-full-database-backup` and `check-overdue-reports-daily`). Removes a long-lived anon key embedded in `pg_cron`'s command text and matches existing security posture.

### 3. Add a 6-day idempotency guard to weekly backup

Wrap the `weekly-full-database-backup` cron body so it skips the call if a successful backup already exists in `backup_history` within the past 6 days. One-line `WHERE NOT EXISTS (...)` guard. Prevents accidental double runs from costing a second full DB scan.

## Out of scope

- No edge-function code changes — only cron scheduling and SQL.
- Not touching `weekly-trigger-health-check`, `nightly-retention-cleanup`, or `cleanup-expired-deleted-records` — those are infrequent and cheap.
- Not converting email queue to event-driven (would require a Postgres NOTIFY listener in the edge function); 30s polling is the simplest, safest win.

## Technical details

All three changes are done via `cron.unschedule(...)` + `cron.schedule(...)` in a single Supabase insert call (per project convention — these jobs reference user-specific URLs/secrets so they go through the **insert** tool, not migrations).

### Expected savings


| Job                         | Before              | After     | Daily invocations saved   |
| --------------------------- | ------------------- | --------- | ------------------------- |
| process-email-queue         | every 5s            | every 30s | ~14,400/day               |
| weekly-full-database-backup | possible double-run | guarded   | up to 1 full DB export/wk |


Roughly an order-of-magnitude reduction in baseline edge-function invocations.

## Verification

After applying, re-query `cron.job` to confirm the new schedules, and watch `backup_history` plus `pgmq.q_*` over the next 24h to confirm emails still flow and backups still record.