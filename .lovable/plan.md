

# Fix: "Checking for Updates" Timeout and Stale Version in Preview

## Problem

Two symptoms, one root cause:

1. **"Checking for updates..." hangs forever** -- `ManualUpdateButton.tsx` calls `navigator.serviceWorker.ready` (line 62) which returns a Promise that never resolves in environments where service workers do not activate (like the Lovable preview iframe). The loading toast is never dismissed.

2. **Version stuck at v2.8.3** -- `usePWAUpdate.tsx` also awaits `navigator.serviceWorker.ready` (line 17), which never resolves. Without the SW lifecycle completing, stale cached bundles (containing the old version string) persist.

The production website and installed mobile PWA work fine because service workers activate normally there.

## Fix (2 files, no UI/styling changes)

### File 1: `src/components/pwa/ManualUpdateButton.tsx`

Wrap the `navigator.serviceWorker.ready` call in a timeout race (5 seconds). If it times out, dismiss the loading toast and show a user-friendly message instead of hanging forever.

**Change in `handleCheckForUpdates` (lines 61-65):**

```text
Current:
  const registration = await navigator.serviceWorker.ready;
  await registration.update();
  await new Promise(resolve => setTimeout(resolve, 2000));

New:
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Service worker not available')), 5000)
    )
  ]) as ServiceWorkerRegistration;
  await registration.update();
  await new Promise(resolve => setTimeout(resolve, 2000));
```

The existing `catch` block (lines 90-98) already handles errors by dismissing the toast and showing "Update check failed" -- this timeout error will flow into that naturally.

### File 2: `src/hooks/usePWAUpdate.tsx`

Add the same timeout race to the two `navigator.serviceWorker.ready` calls (lines 17 and 62) so the hook does not hang indefinitely in preview environments.

**Change 1 -- Primary ready call (line 17):**

```text
Current:
  navigator.serviceWorker.ready.then((reg) => { ... })

New:
  Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('SW timeout')), 5000)
    )
  ]).then((reg: ServiceWorkerRegistration) => { ... })
   .catch(() => {
     // SW unavailable in this environment (e.g. preview iframe)
   });
```

**Change 2 -- updatefound listener (line 62):**

Same timeout race pattern applied to the second `navigator.serviceWorker.ready.then(...)` block.

## What Does NOT Change

- No UI or styling modifications
- No changes to the version badge, version modal, or glassmorphism styling
- No changes to sync logic, auto-save, or report data handling
- No new dependencies
- The production PWA and installed mobile app behavior remain identical (the timeout only fires in environments where SW never activates)

## Why This Fixes Both Issues

- The hanging toast will now time out after 5 seconds and show a clear error message via the existing catch handler
- The `usePWAUpdate` hook will gracefully degrade instead of waiting forever, allowing the rest of the app (including version display from `import.meta.env.APP_VERSION`) to function normally
- On production/mobile where SW activates within milliseconds, the 5-second timeout is never reached

