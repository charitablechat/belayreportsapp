

## Fix: ItemPhotoUpload Spinner Stuck Indefinitely

### Root Cause

The `ItemPhotoUpload` component has **no timeout protection** around the Supabase storage upload call (line 77-79). If the network stalls or the upload hangs, the `uploading` state stays `true` forever, leaving the spinner spinning indefinitely.

By contrast, `PhotoCapture.tsx` already has proper timeout constants (`PROCESS_SAFETY_TIMEOUT = 12000`, `PER_FILE_TIMEOUT = 10000`) — but `ItemPhotoUpload` was written without these safeguards.

### Plan

**File: `src/components/inspection/ItemPhotoUpload.tsx`**

Wrap the entire `handleUpload` body in a `Promise.race` with a 12-second safety timeout, matching the pattern used in `PhotoCapture`:

1. Add a `UPLOAD_TIMEOUT = 12000` constant (12 seconds total for compress + auth + upload + signed URL)
2. Wrap the upload logic in `Promise.race` against a timeout that rejects after 12s
3. On timeout, show a toast: "Upload timed out — photo saved locally, will retry automatically"
4. Clear `localPreview` and set `uploading = false` on timeout (already handled by `finally`)
5. Add an `AbortController` so the underlying fetch is cancelled on timeout (Supabase storage client supports this via `fetch` options — not natively, so we'll rely on the Promise.race pattern to at least unblock the UI)

The key change is wrapping lines 57-93 in:

```typescript
const UPLOAD_TIMEOUT = 12000;

const uploadWithTimeout = async () => {
  // existing compress + auth + upload logic
};

await Promise.race([
  uploadWithTimeout(),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Upload timed out')), UPLOAD_TIMEOUT)
  ),
]);
```

The `catch` block already handles errors and resets state. We just need to add a specific message for timeout errors:

```typescript
} catch (err: any) {
  const isTimeout = err?.message?.includes('timed out');
  const statusCode = err?.statusCode || err?.status;
  const message = isTimeout
    ? "Upload timed out – please check your connection and try again"
    : statusCode === 403 || statusCode === '403'
      ? "Permission denied – please try logging out and back in"
      : err?.message || "Failed to upload photo";
  toast.error(message);
  setLocalPreview(null);
}
```

### Files Changed

| File | Change |
|------|--------|
| `src/components/inspection/ItemPhotoUpload.tsx` | Add 12s timeout wrapper around upload logic |

No database or backend changes needed.

