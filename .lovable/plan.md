

## Diagnosis: Contact Form Images Not Reaching Developer

### Root Cause

The `contact-attachments` storage bucket is **private** with a SELECT policy that only allows **super admins** to read files:

```sql
-- Current SELECT policy
bucket_id = 'contact-attachments' AND is_super_admin()
```

The client-side code (in `ContactDeveloper.tsx`) uploads the file (INSERT policy allows any authenticated user), then calls `createSignedUrl()` — which requires SELECT permission on the object. **Non-super-admin users cannot generate signed URLs**, so `createSignedUrl` returns an error, the submission throws, and the image never reaches the Make.com webhook.

Even if the user were a super admin, the architecture is fragile: the signed URL expires in 7 days, and the edge function must fetch the file within the same request. A better approach eliminates signed URLs entirely.

### Solution

Change the flow so the client sends only the **storage file path** (not a signed URL), and the edge function uses the **service role key** to download the file directly from storage.

```text
Current (broken):
  Client uploads → createSignedUrl (FAILS for non-admins) → send URL to edge fn

Fixed:
  Client uploads → sends file path to edge fn → edge fn downloads via service role → base64 → Make.com
```

### Changes

**1. `src/components/ContactDeveloper.tsx`**
- After upload, send `uploadData.path` as `attachmentPath` instead of generating a signed URL
- Remove the `createSignedUrl` call entirely

**2. `supabase/functions/send-contact-email/index.ts`**
- Accept `attachmentPath` instead of `attachmentUrl`
- Use a Supabase admin client (service role key) to download the file from the `contact-attachments` bucket directly
- Remove the URL-origin validation (no longer needed — we validate the path is within the expected bucket)
- Keep the file-size validation

### Files Changed

| File | Change |
|------|--------|
| `src/components/ContactDeveloper.tsx` | Send file path instead of signed URL |
| `supabase/functions/send-contact-email/index.ts` | Download file via service role instead of fetching signed URL |

