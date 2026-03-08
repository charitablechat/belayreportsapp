

## Investigation: Completed Reports Webhook — Root Cause Found

### Finding: All 18 Database Triggers Are Still Missing

**Evidence:**
- `information_schema.triggers WHERE trigger_schema = 'public'` returns **0 rows**
- The migration file `20260308165236_*.sql` exists in the repo but was **never applied to the live database**
- This has now failed to apply across **two separate migration attempts**

### What IS Working
| Component | Status |
|-----------|--------|
| `pg_net` extension | Installed (v0.19.5) — HTTP calls from triggers will work once triggers exist |
| 7 trigger functions (`notify_super_admins_*`) | All present in `pg_proc` |
| `webhook_config` table | `WEBHOOK_SECRET` set (64 chars) |
| `MAKE_WEBHOOK_URL` secret | Configured |
| Edge functions deployed | `send-notification-email`, `send-push-notification` — no logs (never invoked) |

### Why It Fails

The entire notification pipeline is dead at step 1:

```text
[Report marked complete]
       ↓
  ❌ TRIGGER (missing) ── nothing fires
       ↓
  ✗ net.http_post never called
       ↓
  ✗ Edge function never invoked
       ↓
  ✗ Make.com never receives webhook
       ↓
  ✗ No email sent
```

All downstream components (functions, secrets, Make.com) are correctly configured. The **sole blocker** is that triggers do not exist in the live database.

### Remediation

Re-apply the same 18 `CREATE TRIGGER` statements via a new migration. The SQL is identical to the existing file — the content is correct, it just needs to land on the database.

This is the third attempt. If the migration tool reports success but triggers still show 0, we have a platform-level migration application issue that needs escalation.

### No Code Changes Required

All trigger functions, edge functions, webhook secrets, and frontend code are correctly implemented. The only action is a database migration to create the trigger bindings.

