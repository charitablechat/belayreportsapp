
Goal: eliminate offline photo timeouts by making photo capture truly local-first (no blocking auth/network before local save), and by hardening IndexedDB failure handling so the UI never “hangs then times out.”

Audit findings (root causes)
1) Blocking auth before local save:
- `src/components/PhotoCapture.tsx` waits on `getUserWithCache()` (5s race) before any offline write.
- `src/components/inspection/ItemPhotoUpload.tsx` does the same.
- On weak/offline iPad/Android conditions, auth + compression budget can hit timeout thresholds before local persistence.

2) Timeout budgets are too tight for mobile media:
- `PhotoCapture` uses `PER_FILE_TIMEOUT=15s`, while compression itself can consume nearly that budget.
- Batch safety timeout is fixed (20s), which is too low for multi-photo processing on mobile.

3) Local save success is not observable:
- `savePhotoOffline()` returns `undefined` for both success and fallback timeout paths, so callers can’t detect write failure and react correctly.

4) Some photo IndexedDB operations bypass the safety wrapper:
- `updateOfflinePhotoCaption`, `getUnuploadedPhotos`, `markPhotoAsUploaded`, `deleteOfflinePhoto` call `getDB()` directly, making failures less controlled and harder to recover from.

Implementation plan
1) Harden offline storage API (single source of truth)
- File: `src/lib/offline-storage.ts`
- Change `savePhotoOffline(...)` to return `Promise<boolean>` (`true` on persisted write, `false` on fallback/timeout/circuit-open).
- Wrap these functions with `withIndexedDBErrorBoundary`:
  - `updateOfflinePhotoCaption`
  - `getUnuploadedPhotos`
  - `markPhotoAsUploaded`
  - `deleteOfflinePhoto`
- Keep fail-fast behavior when circuit breaker is open, but ensure callers get explicit failure signals.

2) Refactor section photo capture to be offline-first
- File: `src/components/PhotoCapture.tsx`
- Remove auth as a precondition for local save.
- New flow per file:
  1) validate/compress
  2) save to IndexedDB immediately
  3) refresh gallery immediately
  4) only then attempt background cloud upload if online and user id is available
- If local save returns `false`, show immediate “local storage unavailable” error (not generic timeout).
- Increase resilience:
  - raise per-file timeout budget (or make it dynamic),
  - make batch safety timeout scale with `files.length`,
  - avoid false timeout toasts when one slow photo still completes.

3) Refactor item-row photo upload to match offline-first behavior
- File: `src/components/inspection/ItemPhotoUpload.tsx`
- Resolve identity via cached local session first (fast path), avoid hard 5s auth race before local save.
- Save local photo first; do online upload as best-effort background step.
- If user identity truly unavailable, fail fast with explicit auth message (not spinner timeout).
- Preserve deterministic file path behavior so later sync and row `photo_url` stay consistent.

4) Tighten offline caption path robustness
- Files:
  - `src/components/PhotoCaptionInput.tsx`
  - `src/components/PhotoGallery.tsx`
- Ensure offline caption save callback is awaited/handled safely and surfaces storage failures immediately.
- Keep captions editable offline and guarantee they survive until sync.

5) Verification plan (critical)
- End-to-end test matrix:
  - iPad Safari + Android Chrome
  - Airplane mode, flaky network, and reconnect scenarios
- Test cases:
  - Add single photo offline (all modules)
  - Add multiple photos offline (batch)
  - Item-level photo offline in Systems/Ziplines/Equipment rows
  - Edit caption offline before sync
  - Reconnect and verify upload + caption persistence
- Pass criteria:
  - No “photo processing timed out” for normal offline capture
  - Photo appears immediately with pending state
  - Sync completes on reconnect without data loss

Technical details (implementation notes)
- No database schema changes required.
- Primary files to modify:
  - `src/lib/offline-storage.ts`
  - `src/components/PhotoCapture.tsx`
  - `src/components/inspection/ItemPhotoUpload.tsx`
  - `src/components/PhotoCaptionInput.tsx`
  - `src/components/PhotoGallery.tsx`
- Optional safety additions:
  - small timing logs per stage (compress/save/upload) for future diagnostics,
  - unit tests around `savePhotoOffline` success/fallback semantics.
