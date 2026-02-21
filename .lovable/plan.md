

## Fix: Report Generation Timeout Too Short

### Root Cause

The `handleGenerateHTML` function in `InspectionForm.tsx` has a hardcoded **10-second timeout** for report generation. The backend function (`generate-inspection-html`) downloads each photo from private storage and converts it to base64 -- this alone can take 10-15+ seconds for reports with 3-5 photos.

When the timeout fires:
1. The button resets to "Generate Report" (looks like nothing happened)
2. The successful backend response arrives moments later but gets discarded
3. The error toast may not appear due to concurrent LockManager issues swallowing it

The backend logs confirm this: a 5-photo report took ~10 seconds just for photo processing, and a 3-photo report took ~4 seconds. Any report with 4+ photos will consistently time out.

### Solution

Increase the generation timeout to **60 seconds** and improve the user feedback so they know the report is still being generated.

### File Changes

**`src/pages/InspectionForm.tsx` (lines 2047-2055)**

1. Change `GENERATION_TIMEOUT` from `10000` (10s) to `60000` (60s)
2. Update the `timeoutPromise` gap from `GENERATION_TIMEOUT - 1000` to `GENERATION_TIMEOUT - 2000` (reject at 58s, safety at 60s)
3. Update the safety timeout log message to say "60 seconds" instead of "10 seconds"

That's it -- a 3-line change. The backend function itself completes fine; the client is just giving up too early.

### Why 60 Seconds?

- Edge functions have a maximum execution time of 60 seconds
- Reports with 10+ photos could realistically take 30-40 seconds
- This matches the maximum the backend can take, so the client will never give up before the server does

