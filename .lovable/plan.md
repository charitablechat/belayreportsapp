

# Fix Plan: Mobile PWA Version Updates Not Propagating

## Problem Summary

The mobile PWA on iOS/Android is stuck on older versions (e.g., v2.1.50) while the deployed version is v2.2.00. Users cannot receive app updates even when clicking "Update Now" because the service worker message to activate the new version is never processed.

## Root Cause

The `SKIP_WAITING` message sent by the app to activate a waiting service worker is never received because **no service worker script has a `message` event listener**.

| File | Purpose | Has message listener? |
|------|---------|----------------------|
| `sw-push.js` | Push notifications | ❌ No |
| `sw-sync.js` | Background sync | ❌ No |
| Auto-generated SW | Caching/routing | Partially (may be overridden by imports) |

## Solution

### Part 1: Add Message Handler to Service Worker

**File:** `public/sw-push.js`

Add a message event listener at the end of the file to handle `SKIP_WAITING` requests from the app:

```javascript
// Handle update messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[Service Worker] Received SKIP_WAITING, activating new version');
    self.skipWaiting();
  }
});
```

This allows the app's update mechanism to immediately activate the new service worker instead of waiting for all tabs to close.

### Part 2: Improve Update Detection Reliability

**File:** `src/hooks/usePWAUpdate.tsx`

Enhance the update mechanism to retry the skip waiting message if the first attempt fails, and add better logging:

```typescript
const updateServiceWorker = async (reloadPage = true) => {
  if (registration?.waiting) {
    console.log('[PWA Update] Activating new service worker');
    
    // Tell the waiting service worker to skip waiting
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    
    // Retry after a short delay if controller doesn't change
    setTimeout(() => {
      if (registration?.waiting) {
        console.log('[PWA Update] Retrying SKIP_WAITING');
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }, 1000);
    
    if (reloadPage) {
      // Small delay to allow SW activation
      setTimeout(() => window.location.reload(), 500);
    }
  } else {
    console.log('[PWA Update] No waiting service worker found');
  }
};
```

### Part 3: Version Increment

**File:** `vite.config.ts`

```typescript
// v2.2.10 - PWA: Added SKIP_WAITING message handler for reliable mobile updates
const APP_VERSION = "2.2.10";
```

## Files to Modify

| Priority | File | Change |
|----------|------|--------|
| P1 | `public/sw-push.js` | Add `message` event listener for `SKIP_WAITING` |
| P2 | `src/hooks/usePWAUpdate.tsx` | Add retry logic and delayed reload |
| P3 | `vite.config.ts` | Update version to v2.2.10 |

## Expected Outcome

After implementation:
1. Users can immediately update the app by clicking "Update Now"
2. Version badge will correctly show v2.2.10 on both mobile and web
3. No more stale versions stuck on mobile PWAs
4. Automatic updates will work more reliably

## Testing Checklist

After implementation, verify on a mobile device:
1. Install the PWA on mobile
2. Deploy a new version with visible version change
3. Open the app and verify "Update Available" notification appears
4. Click "Update Now" and confirm app reloads with new version
5. Check version badge shows v2.2.10
6. Repeat test on iOS Safari (more restrictive SW behavior)

