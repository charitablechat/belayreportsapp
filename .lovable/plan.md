

# Fix: Update Check Shows "Failed" in Preview Environment

## Root Cause

The update check returns `'error'` when the service worker ready promise times out (line 125-129 of `usePWAUpdate.tsx`). In the Lovable preview and desktop browsers without a registered SW, this always times out because no service worker is installed. The user sees "Update check failed" — which is technically correct but misleading. It's not a failure; the SW simply doesn't exist in this context.

On the **published production site** (`ropeworks.lovable.app`), the SW is registered and the check should work normally. This issue is primarily a preview/non-PWA environment problem.

## Changes

### 1. `src/hooks/usePWAUpdate.tsx` — Detect preview/non-SW environments early

Before attempting the 5s timeout on `navigator.serviceWorker.ready`, check if we're in a preview or iframe environment and return `'no_sw'` immediately instead of waiting 5 seconds to fail:

```ts
if (!reg) {
  // In preview/iframe, SW is never registered — skip the 5s wait
  if (isLovablePreview() || window.self !== window.top) {
    return 'no_sw';
  }
  try {
    reg = await withTimeout(navigator.serviceWorker.ready, 5000, 'SW ready (check)');
  } catch {
    return 'no_sw';  // Changed from 'error' to 'no_sw'
  }
}
```

Key changes:
- Import `isLovablePreview` from `@/lib/environment`
- Add iframe detection (`window.self !== window.top`)
- Change the timeout catch from `'error'` → `'no_sw'` (no SW available isn't an error)

### 2. `src/components/pwa/ManualUpdateButton.tsx` — Better messaging for `'no_sw'`

Separate `'no_sw'` from `'up_to_date'` to give context-appropriate feedback:

```ts
if (result === 'up_to_date') {
  toast.info('App is up to date', { description: 'You have the latest version' });
} else if (result === 'no_sw') {
  toast.info('App is up to date', { description: 'Update checks are available in the installed app' });
}
```

### Files Modified
- `src/hooks/usePWAUpdate.tsx` — early return for preview/iframe, change timeout catch to `'no_sw'`
- `src/components/pwa/ManualUpdateButton.tsx` — separate `'no_sw'` messaging

