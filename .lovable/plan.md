

## Automate Daily Backup at 8 PM ET with Email Notification

**What you get**: Every day at 8 PM Eastern, the system automatically runs a full database backup, saves it to cloud storage, and emails you a summary with a download link at kale@belayreports.com.

---

### 1. New Edge Function: `scheduled-backup-notify`

Creates a new edge function that:
1. Calls the same backup logic as `export-full-backup` (reuses the TABLES list and `fetchAllRows` pattern)
2. After saving to storage, generates a 7-day signed download URL
3. Sends an email via Resend to kale@belayreports.com with:
   - Subject: "Ropeworks Daily Backup — [date]"
   - Backup summary (total rows, file size, timestamp)
   - Direct download link (valid 7 days)
   - Table-by-table row counts

**File**: `supabase/functions/scheduled-backup-notify/index.ts`

**Config**: Add `verify_jwt = false` entry in `supabase/config.toml` (cron invokes without JWT).

---

### 2. Schedule pg_cron Job

8 PM Eastern = midnight UTC (EDT) or 1 AM UTC (EST). Using `0 0 * * *` UTC to match EDT (summer), which is close enough year-round. Alternatively `0 1 * * *` for EST.

We'll use `0 0 * * *` (midnight UTC = 8 PM EDT). During EST months it'll run at 7 PM ET instead of 8 PM — acceptable tradeoff, or I can note this.

Uses `pg_cron` + `pg_net` to HTTP POST to the edge function URL with the anon key, same pattern as `check-overdue-reports`.

---

### Summary of Changes

| Change | Details |
|--------|---------|
| New file | `supabase/functions/scheduled-backup-notify/index.ts` |
| Config update | `supabase/config.toml` — add `verify_jwt = false` for the new function |
| Database | pg_cron job via SQL insert (not migration) — runs daily at midnight UTC |

