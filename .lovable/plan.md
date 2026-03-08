

## Ensuring Attachments Reach the Email

### Current Flow (Already Working Code-Side)
1. Frontend uploads file to `contact-attachments` bucket
2. Generates a signed URL (7-day expiry)
3. Edge function sends `attachmentUrl`, `attachmentName`, `attachmentType` to Make.com webhook

### The Problem
Make.com receives the signed URL as a string, but it doesn't automatically download and attach the file to the outgoing email. You need to configure Make.com to fetch the file.

### Option A: Make.com Configuration (No Code Changes)
In your Make.com scenario, between the Webhook module and the Gmail/Email module:
1. Add an **HTTP > Get a file** module
2. Set its URL to `{{attachmentUrl}}` from the webhook data
3. In the Gmail module, map the downloaded file as an attachment using the output of the HTTP module

### Option B: Send Base64 Inline (Code Change)
Modify the edge function to download the file from the signed URL and convert it to base64 before sending to Make.com. This eliminates the need for Make.com to fetch anything — the file data arrives inline.

**File:** `supabase/functions/send-contact-email/index.ts`

After the existing validation, before sending to Make.com:
- If `attachmentUrl` is present, fetch the file content
- Convert to base64
- Include `attachmentBase64`, `attachmentName`, and `attachmentType` in the webhook payload

This makes the Make.com scenario simpler — the Gmail module can directly use the base64 data as an attachment without an extra HTTP module.

### Recommendation
**Option B** is more reliable because:
- The edge function has direct access to the storage URL (same infrastructure, no CORS issues)
- Make.com doesn't need to handle authentication or URL expiry
- Simpler Make.com scenario configuration
- The 10MB file size limit is already enforced, so base64 overhead is manageable

### Implementation (Option B)
Single file change to `supabase/functions/send-contact-email/index.ts`:
- Add a helper to fetch and base64-encode the attachment
- Replace `attachmentUrl` with `attachmentBase64` in the webhook payload
- Keep `attachmentName` and `attachmentType` for Make.com to reconstruct the file

