## Goal

Whenever the app finishes applying a PWA update (whether the user clicked "Install Update" or it happens automatically in the future), show a clear celebration so the user knows the update landed: a confetti burst plus a styled toast with the new version.

## How the signal already works

`src/hooks/usePWAUpdate.tsx` already writes `localStorage['pwa-update-just-applied'] = 'true'` right before reloading the page in `updateServiceWorker(...)`. After reload, the hook silently removes that key. We'll repurpose this as the "an update was just applied" signal so any future auto-update path that goes through `updateServiceWorker` is automatically covered.

## Changes

1. **`src/hooks/usePWAUpdate.tsx`** — Remove the silent auto-clear of `pwa-update-just-applied` in the mount effect (lines 64-68). Leave the write site untouched. The new component below becomes the sole consumer/clearer, eliminating a race.

2. **New `src/components/pwa/UpdateAppliedCelebration.tsx`** — A tiny mount-only component:
   - On mount, read `localStorage['pwa-update-just-applied']`. If absent, render nothing.
   - Otherwise, immediately remove the key (idempotent — guards against StrictMode double-mount), then:
     - Call `triggerCompletionConfetti()` from `src/lib/confetti.ts` (already mobile-tuned).
     - Show a Retro-Tech Terminal–styled `toast.success('UPDATE INSTALLED', { description: 'Now running v{APP_VERSION}', duration: 5000 })` reusing the same monospace/green styling pattern as `showHardSavedToast` in `src/lib/toast-helpers.ts` so it matches the existing brutalist aesthetic.
   - Returns `null`.

3. **`src/App.tsx`** — Mount `<UpdateAppliedCelebration />` next to `<UpdateNotification />` (around line 181) so it runs once per app load.

## Out of scope

- No changes to update-detection logic, the "UPDATE AVAILABLE" banner, sync flows, version-check polling, or any styling beyond the new toast.
- No new dependencies — `canvas-confetti` and `sonner` are already in use.
- We are not changing whether updates apply automatically; we're only ensuring that whenever they do, the user gets feedback.
