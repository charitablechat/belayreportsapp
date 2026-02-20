

# Fix: Email Notifications Not Firing on Report Completion

## Root Cause

The notification triggers **are** firing correctly. The database triggers call `internal_get_webhook_secret()` which reads the value from the `webhook_config` table, then passes it as `x-webhook-secret` header to the edge functions. The edge functions then compare that header against `Deno.env.get('WEBHOOK_SECRET')` -- the Supabase environment secret.

**These two values don't match.** The database table has one value, and the environment secret has a different one. Every call gets rejected with "Invalid or missing webhook secret" (confirmed in logs from your Endor report completion).

## Fix

Sync the two secrets so they match. One migration will:

1. Generate a fresh, secure random secret
2. Update the `webhook_config` table with the new value
3. Update the Supabase environment secret (`WEBHOOK_SECRET`) with the same new value

This ensures the database triggers and edge functions agree on the shared secret.

## Technical Details

**Step 1: Generate and set a new shared secret**

A database migration will update the `webhook_config` table with a new random 64-character hex secret:

```sql
UPDATE webhook_config 
SET key_value = encode(gen_random_bytes(32), 'hex')
WHERE key_name = 'WEBHOOK_SECRET';
```

**Step 2: Read the new value, then update the Supabase environment secret**

After the migration runs, read the new value from the table and use the `add_secret` tool to set the `WEBHOOK_SECRET` environment secret to the same value.

**Step 3: Redeploy edge functions**

Redeploy `send-push-notification` and `send-notification-email` (and `check-overdue-reports`) so they pick up the new secret.

**Affected edge functions (no code changes, just redeploy):**
- `send-push-notification`
- `send-notification-email`
- `check-overdue-reports`

**No frontend or edge function code changes needed** -- just syncing the secret values.

