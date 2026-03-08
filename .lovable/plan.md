

## Fix: "Install Update" Button Does Nothing

### Root Cause

`needRefresh` is set `true` via two paths:
1. **`updatefound` → `installed` state** — `registration.waiting` exists, `SKIP_WAITING` works
2. **`controllerchange`** — new SW already activated, `registration.waiting` is `null`

When path 2 triggers the banner, clicking "Install Update" calls `updateServiceWorker`, which gates on `registration?.waiting` and silently exits. The button becomes a no-op.

### Fix

In `usePWAUpdate.tsx`, update `updateServiceWorker` to reload if no waiting worker exists but `needRefresh` is true (meaning a new SW is already active):

```typescript
const updateServiceWorker = async (reloadPage = true) => {
  if (registration?.waiting) {
    console.log('[PWA Update] Activating new service worker');
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(() => {
      if (registration?.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }, 1000);
    if (reloadPage) {
      setTimeout(() => window.location.reload(), 500);
    }
  } else if (needRefresh && reloadPage) {
    // New SW already active (triggered via controllerchange) — just reload
    console.log('[PWA Update] New SW already active, reloading');
    window.location.reload();
  } else {
    console.log('[PWA Update] No waiting service worker found');
  }
};
```

### File Changed
- `src/hooks/usePWAUpdate.tsx` — one block edit (~3 lines added)

