

## Fix: Offline-First Image Upload for ItemPhotoUpload

### Problem
`ItemPhotoUpload` (used for per-item photos in Equipment, Ziplines, Operating Systems tables) attempts a direct Supabase upload on capture. When offline or on slow connections, this hits the 12-second timeout and fails. Unlike `PhotoCapture` (the main gallery), it lacks offline-first architecture.

### Root Cause
`ItemPhotoUpload.handleUpload` calls `supabase.storage.upload()` synchronously — there is no IndexedDB save step. When the network is unavailable, the upload races against the timeout and loses.

### Solution
Adopt the same local-first pattern used by `PhotoCapture`:
1. Compress the image
2. Save to IndexedDB immediately via `savePhotoOffline()`
3. Show the local blob preview instantly
4. Attempt background upload only if online (fire-and-forget)
5. Provide clear offline/syncing feedback via toast

### Changes

**1. `src/components/inspection/ItemPhotoUpload.tsx` — Rewrite `handleUpload`**

Replace the current upload-first flow with:
```
1. Compress image
2. Create local blob URL → setLocalPreview (instant feedback)
3. Save to IndexedDB via savePhotoOffline() with metadata
4. Save photo receipt to localStorage
5. Set photoUrl to the local cache key (so the form persists the reference)
6. Call onPhotoChange + onImmediateSave
7. If online: fire-and-forget background upload → on success, markPhotoAsUploaded
8. If offline: toast "Will sync when online"
```

Remove the `Promise.race` timeout wrapper — the local save is fast and doesn't need it.

**2. `src/components/inspection/ItemPhotoUpload.tsx` — Update `loadSignedUrl`**

Current flow fails silently when offline with no cache. Update to:
- Check IndexedDB cache first (already done)
- If offline and no cache, show a placeholder/icon instead of blank space
- Add a retry mechanism when coming back online

**3. `src/components/inspection/ItemPhotoUpload.tsx` — Add offline status indicator**

Import `useNetworkStatus` and show:
- A small `CloudOff` icon overlay on the thumbnail when offline
- Toast messages: "Photo saved locally" (offline) vs "Syncing to cloud..." (online)

**4. `src/components/inspection/ItemPhotoUpload.tsx` — Auth fallback simplification**

Use `getUserWithCache()` with a 3-second timeout (matching PhotoCapture pattern) instead of the current double-check flow that can hang.

### Files
| File | Change |
|------|--------|
| `src/components/inspection/ItemPhotoUpload.tsx` | Rewrite to offline-first: save to IndexedDB first, background upload if online, offline indicators, remove timeout-prone direct upload |

