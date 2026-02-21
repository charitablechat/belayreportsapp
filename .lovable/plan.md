

## Root Cause: CORS Header Mismatch in Edge Functions

### Diagnosis

The edge function `generate-inspection-html` works correctly -- it returns a 200 with a valid signed URL when called directly. The problem is a **CORS preflight failure** in the browser.

The `@supabase/supabase-js` v2.78 client sends additional HTTP headers that the edge function does not allow:
- `x-supabase-client-platform`
- `x-supabase-client-platform-version`
- `x-supabase-client-runtime`
- `x-supabase-client-runtime-version`

The current CORS config only permits: `authorization, x-client-info, apikey, content-type`

When the browser sends the OPTIONS preflight, the server responds with an `Access-Control-Allow-Headers` that doesn't include the extra headers the client is sending. The browser silently blocks the actual POST request. The `supabase.functions.invoke()` call hangs until the 58-second client-side timeout fires.

Only `send-report-email` has the correct CORS headers. All 19 other edge functions have the outdated set.

### Fix

Update the `corsHeaders` in **all 19 affected edge functions** to include the full set:

```text
authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version
```

### Affected Functions (all 19)

1. `generate-inspection-html`
2. `generate-training-html`
3. `generate-daily-assessment-html`
4. `generate-inspection-pdf`
5. `generate-training-pdf`
6. `extract-names`
7. `admin-manage-user`
8. `send-contact-email`
9. `send-training-pdf-email`
10. `send-push-notification`
11. `send-notification-email`
12. `check-overdue-reports`
13. `get-vapid-public-key`
14. `get-logo-base64`
15. `initialize-logos`
16. `cleanup-duplicate-summaries`
17. `migrate-circle-bullets`
18. `migrate-field-history`
19. `temp-convert-logos`

### Priority

The 3 report generators and `extract-names` are the most critical (user-facing). The webhook-triggered functions (`send-push-notification`, `send-notification-email`, `check-overdue-reports`) are called server-to-server and technically don't need CORS, but should be updated for consistency and future-proofing.

### No Other Changes Needed

- The frontend timeout logic in `InspectionForm.tsx` is correct and working as designed
- The edge function backend logic is fully functional
- No database or schema changes required

