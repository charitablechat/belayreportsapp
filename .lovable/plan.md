

# Fix: Update Check Stalls and Never Completes

## Root Cause

Two bugs cause the update check to stall:

### Bug 1: Unbounded `navigator.serviceWorker.ready` await (PRIMARY STALL)
In `usePWAUpdate.checkForUpdates()` line 121:
```ts
const reg = registration || await navigator.serviceWorker.ready;
```
If `registration` is `null` (which happens when the initial 5s SW timeout fires on mount), this falls back to `navigator.serviceWorker.ready` **without any timeout**. This promise can hang indefinitely — especially in preview/iframe environments, on desktop without a registered SW, or on mobile Safari where SW activation is delayed.

### Bug 2: 8-second wait even when no update exists
When no update is available, `updatePromise` always waits the full 8 seconds before resolving `false`. The user sees "Checking for updates..." for 8 seconds with no feedback, which feels like a stall.

### Bug 3: Stale closure in ManualUpdateButton
After `await checkForUpdates()`, line 78 checks `if (!needsUpdate)` — but `needsUpdate` is captured from the render closure. Even if `checkForUpdates` set `needRefresh = true`, the local `needsUpdate` variable is still `false`. The "App is up to date" toast fires incorrectly, then the `useEffect` fires "Update found!" — confusing UX.

## Changes

### 1. `src/hooks/usePWAUpdate.tsx` — Fix the stall and reduce wait time

- **Add timeout** to the `navigator.serviceWorker.ready` fallback (5s, matching init timeout)
- **Reduce** the `updatePromise` safety timeout from 8s → 4s
- **Return a result** from `checkForUpdates` so callers can know the outcome without relying on stale state:
  ```ts
  checkForUpdates: () => Promise<'update_found' | 'up_to_date' | 'no_sw' | 'error'>
  ```

```text
checkForUpdates flow (fixed):

1. If no SW support → return 'no_sw' immediately
2. Get registration with 5s timeout → if timeout, return 'error'
3. If reg.waiting → set needRefresh, return 'update_found'
4. Call reg.update() + listen for updatefound with 4s timeout
5. Return 'update_found' or 'up_to_date'
```

### 2. `src/components/pwa/ManualUpdateButton.tsx` — Use returned result

Replace the stale-closure check with the returned value:
```ts
const result = await checkForUpdates();
if (result === 'up_to_date' || result === 'no_sw') {
  toast.dismiss('update-check');
  toast.info('App is up to date', { ... });
} else if (result === 'error') {
  toast.dismiss('update-check');
  toast.error('Update check failed', { ... });
}
// 'update_found' case handled by the existing useEffect
```

### 3. `src/components/pwa/PWAProvider.tsx` — Update type passthrough

Update the `PWAContextType` interface to reflect the new return type of `checkForUpdates`.

### Files Modified
- `src/hooks/usePWAUpdate.tsx` — timeout guard, reduced wait, return result
- `src/components/pwa/ManualUpdateButton.tsx` — use result instead of stale closure
- `src/components/pwa/PWAProvider.tsx` — update interface type
- `src/hooks/usePWA.tsx` — update fallback type

