

## Fix Image Upload Stability on Apple iPad (and Other Platforms)

### Problem Analysis

After reviewing the full photo pipeline — `PhotoCapture.tsx`, `ItemPhotoUpload.tsx`, `image-compression.ts`, `offline-storage.ts`, `cached-auth.ts`, and `heic-converter.ts` — I've identified several issues that specifically cause timeouts, freezes, and failures on iPads:

1. **iPad memory pressure from large photos**: iPad cameras produce 12MP+ HEIC images (5-10MB). The `compressImage` pipeline loads these into memory via `createImageBitmap`, draws to a full-resolution canvas, then converts to blob — all in the main thread. On iPads with Safari's aggressive memory limits, this causes WebKit to kill the tab or freeze.

2. **Overlapping timeouts create race conditions**: `PROCESS_SAFETY_TIMEOUT` (12s) in `PhotoCapture` can fire while `COMPRESSION_TIMEOUT` (8s) and `PER_FILE_TIMEOUT` (10s) are still resolving. The safety timeout force-releases the mutex and shows an error, but the compression promise still resolves and tries to write to IndexedDB — triggering state corruption.

3. **HEIC conversion is unbounded**: `heic2any` is a heavy WASM library. On iPad Safari, converting a single HEIC photo can take 15-20 seconds. There's no timeout on the `convertHeicBlobToJpeg` call inside `compressImageInternal` — it runs before the 8s compression timeout starts, meaning total time can exceed all safety nets.

4. **`ItemPhotoUpload` auth fallback causes double-fetch**: Lines 170-183 call `getUserWithCache()` then on failure immediately call `supabase.auth.getSession()`. On iPad with flaky connectivity, both calls can stall, hitting the 3s timeout but then spawning a second network call.

5. **IndexedDB contention on iPad Safari**: Safari's IndexedDB implementation is notoriously slow. Saving a 3MB compressed blob while the circuit breaker polling, auto-sync, and gallery refresh are all hitting IndexedDB causes lock contention — leading to the 5s `OPERATION_TIMEOUT` being hit.

6. **Multiple photos processed sequentially without yielding**: The `for` loop in `processFiles` processes files one after another without yielding to the main thread — on iPad Safari this blocks the UI thread for the full batch duration.

### Changes

| File | Change |
|------|--------|
| `src/lib/image-compression.ts` | 1. Add timeout wrapper around HEIC conversion (8s limit). 2. Reduce `maxWidth`/`maxHeight` to 1600px on mobile to reduce canvas memory. 3. Release canvas memory immediately after blob creation by zeroing dimensions. 4. Increase `COMPRESSION_TIMEOUT` to 15s to accommodate HEIC conversion time. |
| `src/components/PhotoCapture.tsx` | 1. Increase `PROCESS_SAFETY_TIMEOUT` to 20s and `PER_FILE_TIMEOUT` to 15s to align with compression timeouts. 2. Add `await new Promise(r => setTimeout(r, 0))` yield between files in the batch loop to prevent UI thread starvation. 3. Deduplicate timeout layers — remove `PER_FILE_TIMEOUT` race wrapper since compression already has its own timeout. |
| `src/components/inspection/ItemPhotoUpload.tsx` | 1. Remove the double auth fallback — use only `getUserWithCache()` with a 5s timeout (matching PhotoCapture). 2. Fix the `getUserWithCache()` result destructuring bug on line 175 (`result?.data?.user?.id` should be `result?.id` since `getUserWithCache` returns `CachedUser` directly, not the Supabase response shape). |
| `src/lib/heic-converter.ts` | Add a 10s timeout wrapper around the `heic2any` call to prevent unbounded hangs on iPad Safari. |
| `src/lib/offline-storage.ts` | Increase the photo-save operation timeout from 5s to 8s for blob writes (large photos need more time on slow iPad IndexedDB). Add a dedicated `savePhotoWithExtendedTimeout` path that bypasses the generic 5s `OPERATION_TIMEOUT` for photo blobs specifically. |

### Key Architectural Decisions

- **HEIC timeout is critical**: The single biggest iPad freeze vector. A 10s cap on `heic2any` with graceful fallback (return original file) prevents unbounded hangs.
- **Canvas memory cleanup**: Setting `canvas.width = 0; canvas.height = 0` after blob creation explicitly releases the backing store — critical on iPad Safari where canvas memory is limited to ~256MB.
- **Yield between files**: A single `setTimeout(0)` between photos lets Safari's UI thread repaint and handle touch events, preventing the "frozen screen" experience.
- **Auth bug fix**: `ItemPhotoUpload` line 175 has a real bug — `getUserWithCache()` returns `CachedUser | null` (plain object with `.id`), not the Supabase response wrapper. This silently fails auth on every upload, falling through to the second `getSession()` call, doubling latency.

### No database or RLS changes needed. No edge function changes needed.

