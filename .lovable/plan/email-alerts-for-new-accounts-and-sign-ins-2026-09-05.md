# Email alerts for new accounts and sign-ins

Get notified by email whenever someone creates an account on Belay Reports, plus a once-a-day summary of who signed in.

## What you'll get

**1. New account alert (within ~15 minutes of sign-up)**

Subject: `New Belay Reports account: Jane Doe`

- Name and email address
- How they signed up (email/password or Google)
- Date and time (Central time)
- Running total of accounts created

**2. Daily sign-in summary (once each morning, 7:00 am Central)**

- List of everyone who signed in during the previous 24 hours, with the time of their most recent sign-in
- New accounts created that day, flagged
- If nobody signed in, no email is sent — so a quiet day stays quiet

**Who receives them:** kale@belayreports.com to start. Additional recipients can be added, and you can tell me the addresses either now or after you see the first email.

**Sender:** the existing Belay Reports sender (`noreply@mail.belayreports.com`) already used for backup notifications — nothing new to set up, no extra cost, no AI credits.

## Why a 15-minute check instead of instant

The account list lives in the protected sign-in system, which the app is not allowed to attach instant triggers to. A small scheduled check reads it on a timer instead. That keeps the security boundary intact and still gets the alert to you promptly.

## Technical notes

- New edge function `notify-account-activity` with two modes: `new_accounts` and `daily_summary`. Reads accounts via the admin auth API using the service role; no schema changes to protected schemas and no triggers on `auth`.
- New table `account_notify_state` (single row) storing `last_seen_created_at` and `last_summary_sent_at` so the same account is never reported twice; RLS enabled, service-role only, with explicit GRANTs.
- New table `account_notify_recipients` (email, active) seeded with kale@belayreports.com; admin-only read/write via `is_admin_or_above`, service-role read in the function.
- Two `pg_cron` jobs (same pattern as the existing weekly health check and scheduled backup notify): every 15 minutes for new accounts, daily at 12:00 UTC for the summary. Both call the function with the existing webhook-secret header pattern used by `send-notification-email`.
- Sending uses Resend with `RESEND_API_KEY_1`, mirroring `scheduled-backup-notify`; email body built with the same inline-styled HTML approach.
- Migration is additive and reversible: two tables plus two cron jobs, no changes to existing tables, functions, or auth settings.

## Not included

- No per-sign-in instant alerts (too noisy — a daily digest instead).
- No changes to the sign-up screen, auth settings, or any existing email.
