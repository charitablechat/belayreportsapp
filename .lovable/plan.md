

# Fix: Overdue Reports Cron Job -- Webhook Secret Case Mismatch

## Problem

The scheduled cron job that checks for overdue reports every day at 07:00 UTC is silently failing. It queries `webhook_config WHERE key_name = 'webhook_secret'` (lowercase), but the stored key is `'WEBHOOK_SECRET'` (uppercase). This means the edge function receives a null secret and returns 401 Unauthorized.

## Fix

A database migration will:

1. **Unschedule** the broken cron job (`check-overdue-reports-daily`)
2. **Reschedule** it with the corrected uppercase `'WEBHOOK_SECRET'` lookup

No edge function or frontend changes are needed -- only the cron SQL command is wrong.

---

## Technical Details

**Migration SQL:**

```sql
-- Remove the broken cron job
SELECT cron.unschedule('check-overdue-reports-daily');

-- Re-create with corrected case: 'WEBHOOK_SECRET' (uppercase)
SELECT cron.schedule(
  'check-overdue-reports-daily',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ssgzcgvygnsrqalisshx.supabase.co/functions/v1/check-overdue-reports',
    headers := (
      SELECT jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', (SELECT key_value FROM webhook_config WHERE key_name = 'WEBHOOK_SECRET' LIMIT 1)
      )
    ),
    body := '{"source": "cron"}'::jsonb
  ) AS request_id;
  $$
);
```

**Files changed:** One database migration only. No code files modified.

