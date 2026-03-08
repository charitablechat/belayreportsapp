

## Replace Resend with Make.com Webhook

Replace the Resend email API call in the `send-contact-email` edge function with a POST to a Make.com webhook URL. All existing validation, rate limiting, honeypot detection, and attachment handling remain unchanged.

### What Changes

**`supabase/functions/send-contact-email/index.ts`** (lines 165-216)

Remove:
- `RESEND_API_KEY` lookup and Resend `fetch` call
- HTML email template construction

Replace with:
- `MAKE_WEBHOOK_URL` secret lookup
- Single `fetch` POST to the Make.com webhook with a JSON payload containing: `name`, `email`, `subject` (human-readable), `message`, `attachmentUrl`, `attachmentName`, `attachmentType`

### Secret Required

A new secret `MAKE_WEBHOOK_URL` needs to be added. You'll create a Make.com scenario with a "Custom Webhook" trigger module and paste the generated URL as the secret value.

### Edge Function Change (Conceptual)

```typescript
// BEFORE (lines 165-216):
const resendApiKey = Deno.env.get("RESEND_API_KEY");
// ... Resend fetch ...

// AFTER:
const makeWebhookUrl = Deno.env.get("MAKE_WEBHOOK_URL");
if (!makeWebhookUrl) throw new Error("MAKE_WEBHOOK_URL not configured");

const webhookResponse = await fetch(makeWebhookUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name, email, subject: subjectText, message,
    attachmentUrl, attachmentName, attachmentType,
    timestamp: new Date().toISOString(),
  }),
});

if (!webhookResponse.ok) {
  throw new Error(`Make.com webhook failed: ${webhookResponse.status}`);
}
```

Everything upstream (CORS, rate limiting, honeypot, validation, attachment URL verification) stays exactly as-is.

