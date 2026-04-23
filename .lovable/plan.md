

## S34 — Skip `sync-photos-updated` dispatches when nothing changed

### Problem

`useAutoSync.tsx` dispatches `window.dispatchEvent(new CustomEvent('sync-photos-updated'))` after every sync cycle (L349–350 inside the inspection sync flow, L472–473 inside the training/assessment flow). The sole consumer, `useUnsyncedPhotos`, responds by running `getUnuploadedPhotos(user.id)` + `getDeadLetterPhotos()` — two more IDB index scans — whether or not the photo count actually changed. On a quiet sync (no photos uploaded, no failures, no deletes), this is pure IDB pressure on the very Safari/iOS path S2/S11/S30/S32 already work to relieve.

### Fix

**Only dispatch when something photo-related actually changed in the cycle.** Track per-cycle photo deltas in `useAutoSync` and dispatch the event at most once per cycle, only when the delta is non-zero.

### Changes

**`src/hooks/useAutoSync.tsx`**

1. Inside `performSync` (the function that wraps both report sync flows), declare a single local counter at the top:
   ```ts
   let photoChangeCount = 0;
   ```
   Pass a small `onPhotoChange = () => { photoChangeCount++ }` callback (or capture via closure) into the spots that currently know they touched a photo:
   - successful photo upload
   - photo moved to dead-letter
   - photo retried out of dead-letter
   - photo deleted from IDB after successful server upload
2. Replace **both** existing `window.dispatchEvent(new CustomEvent('sync-photos-updated'))` calls (L349–350 and L472–473) with a single guarded dispatch at the **end** of `performSync`:
   ```ts
   if (photoChangeCount > 0) {
     window.dispatchEvent(new CustomEvent('sync-photos-updated'));
   }
   ```
3. If a downstream call site (e.g. inside `atomic-sync-manager.ts`) also fires its own `sync-photos-updated` event today, leave those alone for this task — they're targeted and rare. Only the blanket per-cycle dispatch in `useAutoSync` is the issue.

**`src/hooks/useUnsyncedPhotos.tsx`** — no change. Its existing 5-min safety tick (`SAFETY_REFRESH_MS`) plus the now-meaningful event are sufficient. The existing `idbReadError` preservation logic continues to handle transient IDB failures.

### Out of scope

- Replacing the event with a direct ref/subscription — overkill for one consumer; the event API stays.
- Debouncing the event itself — not needed once it's gated behind a real change.
- Touching `getUnsyncedPhotos`/`getDeadLetterPhotos` internals — they're already as cheap as IDB scans get.

### Risk

Negligible. A quiet sync now produces zero photo refresh — which is exactly correct: nothing changed, the badge can't have changed. The 5-minute safety tick in `useUnsyncedPhotos` still catches any drift from out-of-band IDB writes (e.g. a photo captured on another tab). On any cycle that actually moves a photo, the event still fires exactly once.

### Verification

- `npx tsc --noEmit`.
- Manual: with the dashboard open, trigger an empty sync (no unsynced data) 5×; confirm `sync-photos-updated` does NOT fire (DevTools event listener breakpoint), and `useUnsyncedPhotos` does NOT re-scan IDB.
- Manual: capture a photo offline → go online → confirm badge decrement still happens within ~3s of upload (event fires once).
- Manual: force a photo into dead-letter (offline + bad token) → confirm badge updates.

