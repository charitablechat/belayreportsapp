

## Root Cause Analysis: Contact Developer Feature

### Bug: Field Name Mismatch Between Frontend and Edge Function

**Frontend (`ContactDeveloper.tsx` line 104)** sends:
```typescript
body: {
  name: "Kale Dabling",
  email: "kale@myaisummit.dev",
  subject: form.subject,
  message: form.message,
  imageUrl,          // ← sends "imageUrl"
  website: form.website,
}
```

**Edge function (`send-contact-email/index.ts` line 50)** destructures:
```typescript
const { name, email, subject, message, attachmentUrl, attachmentName, attachmentType, website } = await req.json();
//                                      ^^^^^^^^^^^^^ expects "attachmentUrl"
```

The image URL is sent as `imageUrl` but the function reads `attachmentUrl` — so it's always `undefined`. This doesn't cause a crash (the function proceeds without an attachment), but the image is silently dropped.

**However, this alone wouldn't cause the submission to fail.** The validation and Make.com webhook call should still succeed for text-only submissions. The edge function logs show only `shutdown` events with no error traces, suggesting the function may not be receiving invocations at all — or Make.com is rejecting the POST.

### Additional Finding: No User Feedback on Errors

The frontend `catch` block (line 114) only does `console.error` — no toast or UI feedback. If the function returns an error, the user sees "Sending..." briefly then nothing happens. This makes failures invisible.

### Fix Plan (2 changes)

**1. Fix field name mismatch in `ContactDeveloper.tsx` (line 98-107)**

Change `imageUrl` to `attachmentUrl` (and add `attachmentName` and `attachmentType` which the edge function also expects):

```typescript
const { error } = await supabase.functions.invoke("send-contact-email", {
  body: {
    name: "Kale Dabling",
    email: "kale@myaisummit.dev",
    subject: form.subject,
    message: form.message,
    attachmentUrl: imageUrl,
    attachmentName: imageFile?.name,
    attachmentType: imageFile?.type,
    website: form.website,
  },
});
```

**2. Add toast feedback for success and failure**

Import `toast` from sonner and add user-visible feedback in both the success and error paths so submissions aren't silently swallowed.

### Verification Checklist
- `MAKE_CONTACT_WEBHOOK_URL` secret exists — confirmed in secrets list.
- Edge function logic is correct — validation, rate limiting, honeypot, and webhook POST are all properly implemented.
- Separation of concerns — this function uses `MAKE_CONTACT_WEBHOOK_URL`, completely isolated from the report notification pipeline (`MAKE_WEBHOOK_URL`).
- The only code bug is the field name mismatch and missing user feedback.

