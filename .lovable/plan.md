

# Fix PWA Update Check: False Positives and Delayed Detection

## Problem

When the user clicks "Check for Updates", the function returns `up_to_date` even when an update exists. Minutes later, the background `updatefound` listener fires and shows the update banner — contradicting the earlier toast. Two root causes:

1. **`updatefound` handler waits too long**: Once `updatefound` fires (confirming an update exists), the code waits for the SW to reach `installed` state before resolving `true`. On slower connections, the 4s safety timeout fires first, resolving `false` — a false negative.

2. **SW_READY_TIMEOUT_MS too aggressive (1.5s)**: On cold starts or slower devices, `navigator.serviceWorker.ready` may not resolve in 1.5s, causing the function to bail with `no_sw` even though the SW is available.

3. **Stale closure in ManualUpdateButton**: `handleCheckForUpdates` captures `needsUpdate` from the render closure. If `checkForUpdates` internally sets `needRefresh=true` but the component hasn't re-rendered yet, the function still sees the old `needsUpdate=false` value.

## Changes

### 1. `src/hooks/usePWAUpdate.tsx`

- **Increase `SW_READY_TIMEOUT_MS`** from `1500` to `5000` — gives the SW registration time to resolve on slower devices.
- **Resolve `updatefound` immediately**: When the `updatefound` event fires, resolve `true` right away instead of waiting for the SW to reach `installed` state. The existence of `updatefound` already confirms an update is available — no need to wait for installation to complete before telling the user.

Specific change in `checkForUpdates` (line ~206-225): simplify the `onUpdateFound` handler to just call `resolveOnce(true)` immediately, removing the `statechange` listener logic.

### 2. `src/components/pwa/ManualUpdateButton.tsx`

- **Fix stale closure**: Handle the `update_found` result directly in `handleCheckForUpdates` instead of relying on the `useEffect` watching `needsUpdate`. When `checkForUpdates()` returns `'update_found'`, show the success toast and haptic immediately in the same function, ensuring the user gets instant feedback.
- **Remove the `previousNeedsUpdate` useEffect** that watches for `needsUpdate` transitions — it's redundant once we handle `update_found` inline and causes the delayed/duplicate notification.

### Files Modified
- `src/hooks/usePWAUpdate.tsx` — 2 changes (timeout constant, updatefound handler)
- `src/components/pwa/ManualUpdateButton.tsx` — remove transition watcher useEffect, add inline `update_found` handling

