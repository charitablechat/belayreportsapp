

## S40 — Clarify the misleading photo-sync comment in useAutoSync

### Finding

`src/hooks/useAutoSync.tsx:312-314` says:

> Photos run AFTER report sync because they depend on the temp-ID → UUID mapping

That's only half true. Photos whose parent inspection is still `temp-…` aren't *queued* for the next cycle — they're skipped *and* their `retryCount` is bumped (see S13 in `sync-manager.ts:syncPhotos`, which calls `incrementPhotoRetryCount` for `temp-` parents). After 5 such cycles the photo dead-letters via the normal `MAX_PHOTO_RETRIES` ceiling, surfaced in `SyncDiagnosticsSheet`.

So the comment misleads a future reader into thinking the ordering alone guarantees eventual upload. It doesn't — the ordering is best-effort, and the dead-letter path is the actual safety net.

### Fix

Replace the 2-line comment at `src/hooks/useAutoSync.tsx:312-314` with an accurate version that names the dead-letter behavior. No code change.

```ts
// Photos run AFTER report sync so the temp-ID → UUID swap (performed
// during report sync) is in place before we try to upload. This is
// best-effort: any photo whose parent is still `temp-…` at upload time
// is skipped AND has its retryCount bumped (see sync-manager.ts /
// syncPhotos, S13). After MAX_PHOTO_RETRIES (5) such cycles the photo
// dead-letters and surfaces in SyncDiagnosticsSheet — it is not
// silently re-queued forever.
```

### Out of scope

- Changing the actual skip/dead-letter behavior (that's S13's design and is working as intended).
- Touching `sync-manager.ts` or any other comment.
- Renaming or reordering the sync phases.

### Risk

None. Comment-only edit.

### Verification

- `npx tsc --noEmit` (unaffected; sanity).
- Visual diff confirms only the comment block changed.

