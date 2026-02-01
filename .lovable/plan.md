
# Plan: Fix Mobile Photo Upload Hang and Global Save Freeze

## Root Cause Analysis

### Primary Issue Identified
The console logs reveal **"Item sync timeout"** errors occurring across all data types (inspections, trainings, daily assessments). The photo upload hang on mobile triggers a cascade effect that blocks the global auto-sync system.

### Detailed Investigation Findings

| Finding | Evidence | Impact |
|---------|----------|--------|
| **Image compression can hang** | `compressImage()` uses `canvas.toBlob()` with no timeout (line 87-145 in image-compression.ts) | Blocks `processFiles()` indefinitely on mobile |
| **`savePhotoOffline()` awaits quota check** | Line 594-597 awaits `checkStorageQuota()` before IndexedDB write | Can hang if storage API is slow/blocked |
| **Mutex lock never released on error** | `uploadMutexRef.current = true` at line 105, only reset in `finally` block | If compression promise hangs, mutex stays locked |
| **Global sync blocks on photo hang** | `useAutoSync` calls `syncPhotos()` in parallel with other syncs | If photos hang, 30-second timeout triggers for ALL syncs |
| **Auto-sync cascades timeout** | `SYNC_TIMEOUT = 30000` in useAutoSync.tsx line 17 | Single hung operation times out the entire sync batch |

### The Cascade Effect

```text
User takes photo on mobile
         │
         ▼
compressImage() hangs (no timeout on canvas.toBlob)
         │
         ▼
processFiles() await blocks (line 131-136)
         │
         ▼
uploadMutexRef stays locked (never reaches finally block)
         │
         ▼
UI shows permanent "Saving..." spinner (line 257-260)
         │
         ▼
Meanwhile: useAutoSync periodic sync triggers
         │
         ▼
syncPhotos() iterates over getUnuploadedPhotos() 
which includes the hung photo
         │
         ▼
SYNC_TIMEOUT (30s) triggers for entire sync batch
         │
         ▼
"Item sync timeout" errors logged
         │
         ▼
All save operations appear frozen (isSyncing stays true)
```

---

## Solution Architecture

### Fix 1: Add Timeout to Image Compression

**File**: `src/lib/image-compression.ts`

Wrap the entire compression operation with a timeout. If compression hangs, return the original file.

```typescript
const COMPRESSION_TIMEOUT = 10000; // 10 seconds max

export const compressImage = async (
  file: File,
  options: CompressionOptions = {},
  attemptCount: number = 0
): Promise<File> => {
  // Wrap entire operation with timeout
  const timeoutPromise = new Promise<File>((resolve) => {
    setTimeout(() => {
      console.warn('[Image Compression] Timed out, using original file');
      resolve(file);
    }, COMPRESSION_TIMEOUT);
  });

  try {
    return await Promise.race([
      compressImageInternal(file, options, attemptCount),
      timeoutPromise
    ]);
  } catch (error) {
    console.warn('[Image Compression] Failed, using original:', error);
    return file;
  }
};
```

### Fix 2: Non-Blocking Quota Check in savePhotoOffline

**File**: `src/lib/offline-storage.ts`

The `checkStorageQuota()` call should be fire-and-forget or have a short timeout, not block the IndexedDB write.

```typescript
// Before (blocking):
const quota = await checkStorageQuota();
if (quota.percentUsed > 90) { ... }

// After (non-blocking with timeout):
const quotaCheck = withTimeout(checkStorageQuota(), 2000, { percentUsed: 0 });
quotaCheck.then(quota => {
  if (quota.percentUsed > 90) {
    console.warn('[Offline Storage] Storage almost full');
  }
});
// Continue with IndexedDB write immediately - don't await quota check
```

### Fix 3: Add Safety Timeout to PhotoCapture processFiles

**File**: `src/components/PhotoCapture.tsx`

Wrap the per-file processing with a timeout to prevent infinite hangs.

```typescript
const FILE_PROCESS_TIMEOUT = 15000; // 15 seconds per file max

for (const file of Array.from(files)) {
  try {
    // Wrap entire file processing with timeout
    await Promise.race([
      processOneFile(file, user),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('File processing timeout')), FILE_PROCESS_TIMEOUT)
      )
    ]);
    successCount++;
  } catch (error) {
    console.error('[PhotoCapture] File processing failed/timed out:', error);
    errorCount++;
    toast.error('Photo processing failed', {
      description: 'Please try again with a smaller image',
    });
  }
}
```

### Fix 4: Ensure Mutex Release on Any Failure

**File**: `src/components/PhotoCapture.tsx`

Add an outer try-catch and safety timeout to guarantee mutex release.

```typescript
const processFiles = async (files: FileList | null) => {
  if (uploadMutexRef.current || !files?.length) return;
  
  uploadMutexRef.current = true;
  setUploading(true);
  
  // Safety timeout - ALWAYS release mutex after 30 seconds regardless
  const safetyTimeout = setTimeout(() => {
    if (uploadMutexRef.current) {
      console.warn('[PhotoCapture] Safety timeout - releasing mutex');
      uploadMutexRef.current = false;
      setUploading(false);
    }
  }, 30000);
  
  try {
    // ... existing processing logic ...
  } finally {
    clearTimeout(safetyTimeout);
    setUploading(false);
    uploadMutexRef.current = false;
    // Clear inputs...
  }
};
```

---

## Files to Modify

| File | Priority | Changes |
|------|----------|---------|
| `src/lib/image-compression.ts` | **P0** | Add 10-second timeout wrapper to `compressImage()` |
| `src/components/PhotoCapture.tsx` | **P0** | Add 30-second safety timeout for mutex, 15-second per-file timeout |
| `src/lib/offline-storage.ts` | **P1** | Make `checkStorageQuota()` non-blocking in `savePhotoOffline()` |

---

## Detailed Code Changes

### image-compression.ts

```typescript
// Add at top of file
const COMPRESSION_TIMEOUT = 10000; // 10 seconds

// Rename existing compressImage to compressImageInternal
const compressImageInternal = async (
  file: File,
  options: CompressionOptions = {},
  attemptCount: number = 0
): Promise<File> => {
  // ... existing implementation (lines 27-155) ...
};

// New wrapper function with timeout protection
export const compressImage = async (
  file: File,
  options: CompressionOptions = {},
  attemptCount: number = 0
): Promise<File> => {
  // Skip compression for very small files (moved here for early exit)
  if (file.size < 100 * 1024) {
    return file;
  }

  try {
    // Race between compression and timeout
    const result = await Promise.race([
      compressImageInternal(file, options, attemptCount),
      new Promise<File>((resolve) => {
        setTimeout(() => {
          console.warn('[Image Compression] Timed out after', COMPRESSION_TIMEOUT, 'ms - using original file');
          resolve(file);
        }, COMPRESSION_TIMEOUT);
      })
    ]);
    return result;
  } catch (error) {
    console.warn('[Image Compression] Failed, returning original:', error);
    return file;
  }
};
```

### PhotoCapture.tsx

```typescript
// Add constants at top
const PROCESS_SAFETY_TIMEOUT = 30000; // 30 seconds max for entire batch
const PER_FILE_TIMEOUT = 15000; // 15 seconds per file

// Updated processFiles function
const processFiles = async (files: FileList | null) => {
  // Prevent concurrent uploads
  if (uploadMutexRef.current) {
    console.log('[PhotoCapture] Upload already in progress, ignoring');
    return;
  }
  if (!files || files.length === 0) return;

  uploadMutexRef.current = true;
  triggerHaptic('light');
  setUploading(true);

  // SAFETY: Force release mutex after timeout regardless of promise state
  const safetyTimeout = setTimeout(() => {
    if (uploadMutexRef.current) {
      console.warn('[PhotoCapture] Safety timeout reached - force releasing mutex');
      uploadMutexRef.current = false;
      setUploading(false);
      toast.error('Photo processing timed out', {
        description: 'Please try again with fewer or smaller images',
      });
    }
  }, PROCESS_SAFETY_TIMEOUT);

  let successCount = 0;
  let errorCount = 0;

  try {
    const user = await getUserWithCache();
    if (!user) throw new Error("Not authenticated");

    for (const file of Array.from(files)) {
      try {
        // Wrap per-file processing with timeout
        await Promise.race([
          (async () => {
            // Validation
            const validation = validateFile(file);
            if (!validation.valid) {
              toast.error('Invalid file', { description: validation.error });
              errorCount++;
              return;
            }

            // Compression (already has internal timeout now)
            let processedFile = file;
            if (file.type.startsWith('image/')) {
              processedFile = await compressImage(file, {
                maxWidth: 1920, maxHeight: 1920, quality: 0.85, maxSizeMB: 3,
              });
            }

            // LOCAL SAVE (must not hang)
            const photoId = `${inspectionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            await savePhotoOffline({
              id: photoId, inspectionId, section,
              blob: processedFile, fileName: processedFile.name, uploaded: false,
            });

            onPhotoAdded();
            successCount++;

            // Background sync (fire-and-forget)
            if (isOnline) {
              uploadPhotoInBackground(photoId, processedFile, user.id).catch(() => {});
            }
          })(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('Per-file timeout')), PER_FILE_TIMEOUT)
          )
        ]);
      } catch (fileError: any) {
        console.warn('[PhotoCapture] File processing failed:', fileError.message);
        errorCount++;
        // Continue with other files
      }
    }

    // Show feedback based on results
    if (successCount > 0) {
      triggerHaptic('success');
      toast.success(successCount === 1 ? 'Photo saved' : `${successCount} photos saved`, {
        description: isOnline ? 'Syncing to cloud...' : 'Will sync when online',
        duration: 2000,
      });
    }
    
    if (errorCount > 0 && successCount === 0) {
      triggerHaptic('error');
      toast.error('Failed to process photos', {
        description: 'Please try again with different images',
      });
    }
  } catch (error: any) {
    console.error("Photo capture error:", error);
    triggerHaptic('error');
    toast.error('Failed to save photo', { description: error.message || 'Please try again' });
  } finally {
    clearTimeout(safetyTimeout);
    setUploading(false);
    uploadMutexRef.current = false;
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (uploadInputRef.current) uploadInputRef.current.value = '';
  }
};
```

### offline-storage.ts (savePhotoOffline)

```typescript
export async function savePhotoOffline(photo: { ... }) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      
      // NON-BLOCKING quota check - don't await, just warn if almost full
      checkStorageQuota().then(quota => {
        if (quota.percentUsed > 90) {
          console.warn('[Offline Storage] Storage almost full:', quota.percentUsed.toFixed(1), '%');
        }
      }).catch(() => {}); // Ignore quota check failures

      // Proceed with save immediately (don't wait for quota check)
      await db.put('photos', {
        ...photo,
        timestamp: Date.now(),
        uploaded: photo.uploaded || false,
      });

      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Saved photo:', photo.id);
      }

      // Background sync registration (also non-blocking)
      if (!photo.uploaded) {
        import('./background-sync').then(({ registerPhotoSync }) => {
          registerPhotoSync().catch(() => {});
        }).catch(() => {});
      }
    },
    undefined,
    'savePhotoOffline'
  );
}
```

---

## Testing Checklist

After implementation:
- [ ] Take photo on mobile with slow network - should save locally and show success within 3 seconds
- [ ] Take large photo (>10MB) - should compress or timeout gracefully, never hang
- [ ] Upload multiple photos rapidly - mutex should release properly
- [ ] Disconnect network mid-upload - photo should save locally with "Pending" badge
- [ ] Verify other form fields remain saveable during photo upload
- [ ] Verify auto-sync doesn't block on hung photos
- [ ] Test on iOS Safari (WebKit canvas issues)
- [ ] Test on Android Chrome
- [ ] Force-kill app during upload, reopen - no stuck state

---

## Risk Mitigation

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Timeout too aggressive (10s compression) | Low | Can adjust to 15s; 10s should handle 99% of mobile photos |
| Quota check removal causes storage overflow | Very Low | Still check async and warn user; existing compression limits file sizes |
| Safety timeout fires during legitimate long upload | Low | 30s is generous; fire-and-forget means upload continues in background |

---

## Summary

The root cause is a **missing timeout wrapper** around image compression combined with **blocking quota checks** in IndexedDB operations. When `canvas.toBlob()` hangs on mobile (common on iOS Safari with large images), the entire upload pipeline freezes, the mutex is never released, and the global auto-sync system times out trying to process the stuck photo.

The fix implements **defense-in-depth**:
1. **Per-operation timeouts** (compression, per-file processing)
2. **Non-blocking ancillary operations** (quota checks, background sync registration)
3. **Safety net mutex release** (30-second global timeout)

This ensures the UI remains responsive and users always receive feedback, even under adverse network/hardware conditions.
