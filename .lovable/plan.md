

## Fix: Backup download link saves as .json file instead of displaying in browser

### Problem
The signed URL in the daily backup email opens raw JSON in the browser tab instead of prompting a file download.

### Solution
Use Supabase storage's built-in `download` option when generating the signed URL. This sets `Content-Disposition: attachment; filename="..."` on the response, forcing the browser to save it as a file.

### Change
**File: `supabase/functions/scheduled-backup-notify/index.ts`** (line ~150)

Change the `createSignedUrl` call from:
```typescript
.createSignedUrl(filePath, 60 * 60 * 24 * 7);
```
To:
```typescript
.createSignedUrl(filePath, 60 * 60 * 24 * 7, {
  download: `ropeworks-backup-${timestamp}.json`,
});
```

This is a one-line change. The `download` parameter tells the storage API to include a `Content-Disposition: attachment` header with the specified filename, so clicking the link in the email will save a properly named `.json` file.

