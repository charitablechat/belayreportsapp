

## S22 — Distinguish transient vs permanent photo upload errors and surface them to the UI

**Problem.** In `src/lib/sync-manager.ts`, the photo upload path classifies *all* failures (storage 409/500/network blips, RLS denials, missing bucket, etc.) the same way: increment `retryCount`, log to console, move on. Users see photos sit in the unsynced badge forever with no indication of *why*. Only DB inserts get the unique-violation soft-success treatment — storage uploads do not.

### Design

1. **Classify each upload error.** Add a small `classifyPhotoError(err)` helper in `src/lib/sync-manager.ts` returning one of:
   - `transient` — network failure, `5xx`, `409 Conflict`, `429`, `AbortError`. Retry next cycle, do **not** count toward `MAX_PHOTO_RETRIES`.
   - `permanent` — `400/401/403`, RLS denial, `Bucket not found`, `Invalid key`, `Payload too large`, etc. Bump retry counter and stamp `lastError`.
   - `success-equivalent` — storage `409 Duplicate` *with* `upsert: true` semantics already handled implicitly; treat as success (mark uploaded). DB `23505` is already covered.
2. **Persist last error per photo in IndexedDB.** Extend the offline-photo record with two optional fields: `lastError?: string` (human-readable) and `lastErrorAt?: number` (epoch ms).
   - Add `setPhotoLastError(id, message)` and clear-on-success in `src/lib/offline-storage.ts`.
   - Update `OfflinePhoto` type accordingly. No migration needed — fields are nullable adds.
3. **Update `syncPhotos` flow** in `sync-manager.ts`:
   - Wrap the storage `.upload(...)` in try/classify. On `transient`, log `[Sync Manager] Transient upload error, will retry` and `return` *without* incrementing the retry count. On `permanent`, call `setPhotoLastError` + `incrementPhotoRetryCount`. On `success-equivalent`, fall through to the DB insert path.
   - Same classification around the DB insert (`409`, `5xx` → transient; existing `23505` path unchanged).
   - On any successful path, clear `lastError`.
4. **Surface `lastError` to the UI.**
   - `src/hooks/useUnsyncedPhotos.tsx`: include `lastError` in the returned per-photo data.
   - `src/components/pwa/SyncDiagnosticsSheet.tsx` (existing dead-letter / diagnostics surface): render a "Last error" line per stuck photo with a small `Retry` button that calls a new `resetPhotoForRetry(id)` (zeros `retryCount`, clears `lastError`). For photos whose error is clearly permanent (e.g. `Payload too large`), show a `Discard` button that uses the existing soft-delete path.
5. **Telemetry / dev logs.** Behind `import.meta.env.DEV`, log the classification once per photo per cycle so we can spot misclassification quickly.

### Files

- `src/lib/sync-manager.ts` — add `classifyPhotoError`, rework upload + DB insert error paths, clear `lastError` on success.
- `src/lib/offline-storage.ts` — extend `OfflinePhoto` type with `lastError`/`lastErrorAt`; add `setPhotoLastError(id, msg)` and `resetPhotoForRetry(id)`; ensure `markPhotoAsUploaded` clears these fields.
- `src/hooks/useUnsyncedPhotos.tsx` — propagate `lastError` to consumers.
- `src/components/pwa/SyncDiagnosticsSheet.tsx` — render last-error and Retry/Discard controls per stuck photo.

### Out of scope

- Cross-tab broadcast of error state (the next sync cycle re-reads from IDB).
- Surfacing storage errors during the *initial* foreground capture in `PhotoCapture.tsx` (already toasts via existing receipt fallback).
- Quota/back-pressure on transient retries — `MAX_PHOTO_RETRIES` still bounds permanent failures; transient errors keep retrying every sync cycle.

### Risk

Low.
- New fields are optional; existing IDB records work unchanged.
- The DB-insert `23505` soft-success path is preserved verbatim.
- No public API changes outside `sync-manager` and `offline-storage`.
- Worst-case misclassification → a transient-marked permanent error retries forever; mitigated by the dev-log + visible `lastError` row that the user can `Discard`.

### Verification

- `npx tsc --noEmit`.
- Unit-coverage hook: extend `src/lib/sw-sync-guards.test.ts` (or add `src/lib/sync-manager.test.ts`) to cover `classifyPhotoError` for representative `StorageError` shapes.
- Manual smoke: temporarily throw a fake `5xx` from `supabase.storage.upload`, confirm photo retries without the retry counter incrementing, and that toggling to a 403 surfaces the error in the diagnostics sheet with a working Retry button.

