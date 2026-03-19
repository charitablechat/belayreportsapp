

## Fix Single-Press Update Detection & Add Pulsating "Update Now" Button

### Root Cause
In `usePWAUpdate.tsx`, `checkForUpdates` calls `reg.update()`, waits a fixed 2 seconds, then checks `reg.waiting || reg.installing`. If the new service worker is still downloading or hasn't transitioned to `installed` within that 2s window, `needsUpdate` stays false. The `updatefound` listener in the main `useEffect` eventually sets it — but only after the check has already completed and the UI shows "UP TO DATE."

### Fix

**1. `src/hooks/usePWAUpdate.tsx` — Wait for SW state transition instead of fixed timeout**

Replace the fixed 2s wait in `checkForUpdates` with a promise that resolves when:
- `reg.waiting` is already present (immediate), OR
- The `installing` worker reaches `installed` state (via `statechange` listener), OR
- A 10s safety timeout expires

This ensures `needsUpdate` is set before `checkForUpdates` returns.

```typescript
const checkForUpdates = useCallback(async () => {
  setIsChecking(true);
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.update();

    // Wait for the new SW to reach 'installed' (waiting) state
    if (!reg.waiting) {
      const installing = reg.installing;
      if (installing) {
        await new Promise<void>((resolve) => {
          const onStateChange = () => {
            if (installing.state === 'installed' || installing.state === 'activated') {
              installing.removeEventListener('statechange', onStateChange);
              resolve();
            }
          };
          installing.addEventListener('statechange', onStateChange);
          setTimeout(() => { installing.removeEventListener('statechange', onStateChange); resolve(); }, 10000);
        });
      }
    }

    if (reg.waiting) setNeedRefresh(true);
  } catch { /* ... */ }
  finally { setIsChecking(false); /* timestamp */ }
}, []);
```

**2. `src/components/pwa/UpdateControlPanel.tsx` — Transform "Check Now" into pulsating "Update Now"**

When `needsUpdate` is true, replace the "Check Now" button with a pulsating amber "Update Now" button that calls `handleApplyUpdate` directly. Remove the separate "Apply Update" button to simplify the flow.

```text
┌─────────────────────────┐
│  Before update found:   │
│  [ CHECK NOW ]          │  ← normal outline button
│  [ APPLY UPDATE ] dim   │
│                         │
│  After update found:    │
│  [ ● UPDATE NOW ]       │  ← pulsating amber button, replaces both
│                         │
└─────────────────────────┘
```

### Files affected

| File | Change |
|------|--------|
| `src/hooks/usePWAUpdate.tsx` | Replace fixed 2s wait with SW state transition listener |
| `src/components/pwa/UpdateControlPanel.tsx` | Merge Check/Apply into single context-aware button with pulse animation |

