

## Separate Contact Developer Webhook

### Problem
Both the contact developer form (`send-contact-email`) and the completed report notifications (`send-notification-email`) use the same `MAKE_WEBHOOK_URL` secret, meaning they hit the same Make.com scenario.

### Fix
Introduce a new secret `MAKE_CONTACT_WEBHOOK_URL` and update `send-contact-email` to use it instead. The report notification function keeps using `MAKE_WEBHOOK_URL` unchanged.

### Changes

**1. Add new secret:** `MAKE_CONTACT_WEBHOOK_URL`
- You'll create a separate Make.com scenario with a Custom Webhook trigger for contact form submissions and paste its URL as the secret value.

**2. Edit `supabase/functions/send-contact-email/index.ts`** (lines 165-170)
- Replace `MAKE_WEBHOOK_URL` with `MAKE_CONTACT_WEBHOOK_URL`

```typescript
// BEFORE
const makeWebhookUrl = Deno.env.get("MAKE_WEBHOOK_URL");
if (!makeWebhookUrl) {
  throw new Error("MAKE_WEBHOOK_URL not configured");
}

// AFTER
const makeWebhookUrl = Deno.env.get("MAKE_CONTACT_WEBHOOK_URL");
if (!makeWebhookUrl) {
  throw new Error("MAKE_CONTACT_WEBHOOK_URL not configured");
}
```

No other files change. `send-notification-email` continues using `MAKE_WEBHOOK_URL`.

