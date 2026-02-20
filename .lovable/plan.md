

## Connect Make.com for Notification Emails

### Overview

Replace Resend with a Make.com webhook for sending admin notification emails (inspection completed, training completed, daily assessment completed, sync conflicts). The `send-report-email` function (for emailing reports to clients) stays unchanged with Resend.

### What You Need to Do in Make.com

1. Go to **Make.com** and create a new **Scenario**
2. Add a **Webhooks > Custom Webhook** module as the first step
3. Click on the webhook to get the **webhook URL** (it will look like `https://hook.make.com/abc123...`)
4. Add your email-sending module (Gmail, Outlook, SMTP, etc.) as the next step
5. Map the incoming data fields to your email module:
   - `recipients` -- array of objects with `email`, `name`
   - `subject` -- email subject line
   - `html` -- the fully formatted HTML email body (ready to send as-is)
   - `notificationType` -- type of notification (for filtering/routing if needed)
   - `data` -- extra context (report ID, organization, location, etc.)
6. Since `recipients` is an array, use Make.com's **Iterator** module to loop through and send one email per recipient
7. **Activate** the scenario so it listens for incoming webhooks

### What I Will Change in Lovable

**1. Store the Make.com Webhook URL as a secret**
- Add a new secret called `MAKE_WEBHOOK_URL` with your Make.com webhook URL

**2. Update `send-notification-email` edge function**
- Remove the Resend import and Resend API key check
- Keep all existing logic: webhook secret validation, rate limiting, super admin lookup, notification preference filtering, email fetching, HTML generation
- Replace the Resend email-sending section with a single `fetch()` POST to the Make.com webhook URL
- Send a JSON payload containing:

```text
{
  "recipients": [
    { "email": "admin1@example.com", "name": "Kale" },
    { "email": "admin2@example.com", "name": "Brenda" }
  ],
  "subject": "Inspection Completed",
  "html": "<full HTML email body>",
  "notificationType": "inspection_completed",
  "data": { "inspectionId": "...", "organization": "...", ... }
}
```

- This sends all recipients and the pre-formatted HTML in one call to Make.com, which then handles delivery

**3. No other changes needed**
- Database triggers remain unchanged (they already call `send-notification-email`)
- `send-report-email` (client-facing report emails) continues using Resend
- Push notifications remain unchanged

### Technical Details

```text
Current flow:
  DB Trigger --> send-notification-email --> Resend API --> Email delivered

New flow:
  DB Trigger --> send-notification-email --> Make.com Webhook --> Your email module --> Email delivered
```

The edge function still handles all the "smart" logic (who to notify, preference checks, HTML formatting). Make.com just receives a ready-to-send package and delivers it.

### Steps to Implement

1. You provide the Make.com webhook URL (I will prompt you to enter it as a secret)
2. I update the `send-notification-email` edge function to POST to Make.com instead of Resend
3. The function redeploys automatically
4. You complete a test report to verify emails arrive

