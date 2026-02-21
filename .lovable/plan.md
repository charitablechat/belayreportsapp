

## Fix: Report Generation Silent Timeout Due to Oversized Response

### Problem

The `generate-inspection-html` edge function downloads all inspection photos, converts them to base64, and embeds them directly in the HTML string. It then tries to return this entire HTML (~3-4MB with 5 photos) as a JSON response body. This exceeds the edge function's response size or memory limits, causing a silent crash -- no error is logged, no response is sent, and the client times out after 58 seconds.

### Solution

Upload the generated HTML to storage and return a signed URL instead of the raw HTML. The client then fetches the HTML from storage.

### File Changes

**1. `supabase/functions/generate-inspection-html/index.ts`**

After constructing the HTML string (line ~2614), instead of returning it directly:

- Upload the HTML string as a file to the `inspection-reports` storage bucket (path: `html-reports/{inspectionId}-{timestamp}.html`)
- Create a 24-hour signed URL for the uploaded file
- Return `{ htmlUrl, fileName }` instead of `{ html }`
- Add a completion log so silent failures become visible
- Keep the error handler returning JSON as before

**2. `src/pages/InspectionForm.tsx`**

Update `handleGenerateHTML` (~line 2072-2095):

- After receiving the response, check for `data.htmlUrl` instead of `data.html`
- Fetch the HTML content from the signed URL
- Pass the fetched HTML to the viewer/opener as before
- Add error handling for the fetch step

### Technical Flow

```text
BEFORE (broken):
  Edge Function builds HTML (~3-4MB) --> JSON.stringify --> Response body --> SILENT CRASH

AFTER (fixed):
  Edge Function builds HTML --> Upload to Storage --> Return signed URL (tiny JSON) --> OK
  Client receives URL --> Fetches HTML from Storage --> Opens viewer
```

### Why This Fixes It

- The edge function response shrinks from ~4MB to a few hundred bytes (just a URL)
- The HTML file is uploaded via the Supabase Storage SDK which handles large payloads natively
- The client fetches the HTML directly from storage (no edge function size limits apply)
- Storage already has the `inspection-reports` bucket configured

### Additional Safeguards

- Add `console.log` before and after the upload step so any future failures are visible in logs
- The existing 60-second client timeout and safety reset remain as a fallback
- If the storage upload fails, the error handler catches it and returns a proper error JSON

