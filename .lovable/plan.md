

## Route Email Reports Through Make.com Webhook

### Overview

Replace the current email-sending backend (Resend) with a Make.com webhook. The existing `EmailReportDialog` UI stays the same — users still enter email, name, and message. The backend edge function will forward the payload to a Make.com webhook URL instead of calling Resend directly.

### Architecture

The Make.com webhook URL is a secret and must NOT be stored in frontend code. It will be stored as a backend secret and used inside the edge function.

```text
User clicks "Email" button
        |
        v
EmailReportDialog (existing UI - no changes)
        |
        v
Edge Function: send-report-email (modified)
        |
        v
Make.com Webhook (POST with JSON payload)
```

### Changes Required

#### 1. Store the Make.com Webhook URL as a Secret

- Add a new secret called `MAKE_WEBHOOK_URL` containing the full Make.com webhook endpoint (e.g. `https://hook.us1.make.com/abc123...`)
- You will be prompted to paste the URL when we implement

#### 2. Modify `supabase/functions/send-report-email/index.ts`

- Remove the Resend import and client
- Instead of calling `resend.emails.send(...)`, POST to the Make.com webhook
- Send this exact JSON payload to Make.com:

```json
{
  "recipientEmail": "user-entered email",
  "recipientName": "user-entered name",
  "message": "user-entered message",
  "htmlContent": "<full HTML report>",
  "reportType": "inspection | training | daily_assessment",
  "title": "Report title",
  "organization": "Organization name",
  "date": "Report date",
  "senderName": "Authenticated user's name"
}
```

- Keep all existing validation (auth check, rate limiting, email format validation)
- Keep the `buildEmailHtml()` wrapper so Make.com receives a ready-to-send professional email
- Return success/failure based on the Make.com webhook response (2xx = success)

#### 3. No Frontend Changes

The `EmailReportDialog` component and `HtmlReportViewer` component remain unchanged. They already collect the right data and call the edge function correctly.

### Make.com Scenario Setup (Your Side)

On Make.com, you will need to:
1. Create a new scenario with a "Custom Webhook" trigger
2. Copy the webhook URL and provide it when prompted for the `MAKE_WEBHOOK_URL` secret
3. Add an email module (e.g. Gmail, SMTP, or Mailgun) that:
   - Sets **To** from `recipientEmail`
   - Sets **Subject** from `title` + `organization`
   - Sets **HTML Body** from `htmlContent`
4. Activate the scenario

### Payload Mapping Reference for Make.com

| Make.com Field | JSON Key | Description |
|---|---|---|
| To address | `recipientEmail` | Recipient's email |
| Recipient name | `recipientName` | Optional display name |
| Subject line | `title` + `organization` | Build subject in Make.com |
| HTML body | `htmlContent` | Complete styled HTML email |
| Personal note | `message` | Optional message from sender |
| Sender name | `senderName` | Authenticated user's full name |
| Report type | `reportType` | inspection / training / daily_assessment |
| Date | `date` | Report date string |

