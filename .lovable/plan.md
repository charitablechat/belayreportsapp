

## Fix: Reliable Update Detection on iPad/Safari

### Root Cause

In `checkForUpdates()` (line 108-129 of `usePWAUpdate.tsx`), after calling `reg.update()`, the code checks `reg.installing` synchronously. On iPad/Safari, the service worker lifecycle is slower — `reg.installing` may not be set yet when checked, causing the update to appear undetected. The code also never listens for the `updatefound` event during a manual check, so if the new SW arrives slightly later, it's missed entirely until the next hourly auto-check.

Additionally, on iPad Safari, the `pageshow` event with `event.persisted === true` (BFCache) doesn't trigger a re-check, so returning to the app from another tab may show stale "UP TO DATE" status.

### Changes

**1. `src/hooks/usePWAUpdate.tsx` — Rewrite `checkForUpdates` to use `updatefound` event**

Replace the current synchronous `reg.installing` check with a proper event-driven approach:

```typescript
const checkForUpdates = useCallback(async () => {
  setIsChecking(true);
  try {
    const reg = registration || await navigator.serviceWorker.ready;
    
    // Already waiting? Done.
    if (reg.waiting) {
      setNeedRefresh(true);
      return;
    }

    // Listen for updatefound BEFORE calling update()
    const updatePromise = new Promise<boolean>((resolve) => {
      const onUpdateFound = () => {
        reg.removeEventListener('updatefound', onUpdateFound);
        const sw = reg.installing;
        if (!sw) { resolve(false); return; }
        
        const onStateChange = () => {
          if (sw.state === 'installed' || sw.state === 'activated') {
            sw.removeEventListener('statechange', onStateChange);
            resolve(true);
          }
        };
        sw.addEventListener('statechange', onStateChange);
        // If already installed by the time we attach
        if (sw.state === 'installed' || sw.state === 'activated') {
          sw.removeEventListener('statechange', onStateChange);
          resolve(true);
        }
      };
      reg.addEventListener('updatefound', onUpdateFound);
      
      // Safety: resolve false after 8s if no update found
      setTimeout(() => {
        reg.removeEventListener('updatefound', onUpdateFound);
        resolve(false);
      }, 8000);
    });

    await reg.update();
    
    // Check immediately after update() in case waiting was set synchronously
    if (reg.waiting) {
      setNeedRefresh(true);
      return;
    }

    const found = await updatePromise;
    if (found || reg.waiting) {
      setNeedRefresh(true);
    }
  } catch (error) {
    console.error('[PWA Update] Check failed:', error);
  } finally {
    const now = new Date();
    setLastChecked(now);
    localStorage.setItem('pwa-last-update-check', now.toISOString());
    setIsChecking(false);
  }
}, [registration]);
```

**2. `src/hooks/usePWAUpdate.tsx` — Add iPad/Safari re-check on `pageshow` and `visibilitychange`**

Add a `useEffect` that listens for `pageshow` (BFCache restore) and `visibilitychange` (tab switch) to re-check `reg.waiting`:

```typescript
useEffect(() => {
  const recheckWaiting = () => {
    if (registration?.waiting) setNeedRefresh(true);
  };
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) recheckWaiting();
  };
  const onVisChange = () => {
    if (document.visibilityState === 'visible') recheckWaiting();
  };
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisChange);
  return () => {
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisChange);
  };
}, [registration]);
```

**3. `src/hooks/usePWAUpdate.tsx` — Use stored registration instead of re-awaiting `ready`**

The `checkForUpdates` callback currently re-awaits `navigator.serviceWorker.ready` with a 5s timeout on every click. Use the already-stored `registration` state (set on mount) to avoid redundant waits and potential timeout failures on iPad.

### Files
| File | Change |
|------|--------|
| `src/hooks/usePWAUpdate.tsx` | Rewrite `checkForUpdates` to event-driven; add `pageshow`/`visibilitychange` re-check; use stored registration |

