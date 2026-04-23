

## S41 — Surface sync failures to desktop users too

### Finding

`src/hooks/useAutoSync.tsx:598-603` (in `performSync`'s catch block — the user said `handleOnline` but the actual code is the sync catch path) only fires a notification when `isMobileDevice` is true:

```ts
if (isMobileDevice) {
  addSyncNotification(`Sync failed: ${error?.message || 'will retry automatically'}`);
}
// Desktop toast is not needed here since errors are usually transient and auto-retry handles them
```

The "auto-retry handles them" comment is wishful — desktop users get *zero* visual signal when sync throws. If a record sticks (RLS regression, schema mismatch, regression-skip from S39), the user has no idea until they open SyncDiagnosticsSheet manually.

`src/lib/toast-helpers.ts` already has `toastError(message)` that does exactly the right thing on both platforms: it always pushes to the notification center *and* shows a sonner toast. That's the symmetric primitive we want here.

### Fix

Replace the mobile-gated block in `src/hooks/useAutoSync.tsx:598-603` with a single `toastError` call so both platforms see the failure.

```ts
// Surface sync failures on every platform. toastError pushes to the
// notification center AND shows a sonner toast on desktop; on mobile
// the toast is suppressed and the notification center entry stands in.
const { toastError } = await import('@/lib/toast-helpers');
toastError('Sync failed', error?.message || 'will retry automatically');
```

Dynamic import keeps the existing module-load shape (no new top-level import in a hot file) and matches the surrounding pattern (`import('@/lib/...').then(...)` blocks elsewhere in this file).

### Out of scope

- Throttling repeated failure toasts. If sync flaps every 30s the user will see repeated toasts, but that's also true of the current mobile path — separate ticket if it bites.
- Distinguishing transient vs. permanent failures (would need error classification we don't have).
- Touching the success path or the regression-skip notification (S39 already handles that).

### Risk

Low. `toastError` is already used widely; it can't throw (sonner failures are swallowed). The dynamic import has a `.catch(() => {})` pattern available if we want belt-and-suspenders — propose wrapping the import in a try so even a chunk-load failure can't break the catch block.

### Verification

- `npx tsc --noEmit`.
- DEV desktop: force `performSync` to throw (e.g., temporarily `throw new Error('test')` at the top of the try), confirm a red error toast appears AND the notification center bell shows the entry.
- DEV mobile viewport: same scenario, confirm only the notification center entry appears (no toast overlay), matching prior mobile behavior.
- Confirm the existing `addSyncNotification` import is no longer the only consumer in this catch block (it stays used elsewhere in the file).

