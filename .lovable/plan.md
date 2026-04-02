

## Replace Resend with Lovable Emails for Backup Notifications

### Problem
The `scheduled-backup-notify` edge function uses Resend with the test domain `@resend.dev`, which only allows sending to the Resend account owner's email. Emails to `kale@belayreports.com` are rejected with a 403 error.

### Solution
Switch to Lovable's built-in email infrastructure, eliminating the need for Resend entirely.

### Steps

**Step 1: Set up email domain**
Configure a sender domain (e.g., `belayreports.com`) through Lovable's email setup. This requires adding DNS records at your domain provider.

**Step 2: Set up email infrastructure**
Run the email infrastructure setup to create the queue system, database tables, and processing cron job.

**Step 3: Update `scheduled-backup-notify` edge function**
- Remove the Resend import and API call
- Replace with a call to `send-transactional-email` via `supabase.functions.invoke`
- Keep the existing HTML email template (it's well-designed)

**Step 4: Create a backup notification template**
- Create a React Email template in `_shared/transactional-email-templates/`
- Register it in the template registry
- Style it to match the existing backup email design

**Step 5: Update other Resend-dependent functions**
Check and update these functions that also use Resend:
- `send-report-email`
- `send-contact-email`
- `send-notification-email`
- `send-training-pdf-email`

**Step 6: Deploy all updated edge functions**

### Files Changed

| File | Change |
|---|---|
| `supabase/functions/scheduled-backup-notify/index.ts` | Remove Resend, use `send-transactional-email` |
| `supabase/functions/_shared/transactional-email-templates/backup-notification.tsx` | New template |
| `supabase/functions/_shared/transactional-email-templates/registry.ts` | Register new template |
| `supabase/functions/send-report-email/index.ts` | Remove Resend (later) |
| Other Resend-using functions | Remove Resend (later) |

### First Action Required
You need to set up your email domain. Click below to start:

<lov-actions>
<lov-open-email-setup>Set up email domain</lov-open-email-setup>
</lov-actions>

