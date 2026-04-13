

# Fix: Service Worker Blocking Lovable Preview

## Problem

The "You're Offline" page you see is a **service worker cached fallback page**. The PWA config uses `injectRegister: 'script-defer'` which auto-registers a service worker in ALL environments — including the Lovable editor preview iframe. Once registered, the service worker intercepts all navigation requests and serves cached/offline content, blocking access to the live app.

## Solution

Add an **iframe and preview host guard** in `src/main.tsx` that:
1. Detects when the app is running inside the Lovable preview iframe or on a preview domain
2. **Unregisters any existing service workers** so the cached offline page is removed
3. Prevents the auto-injected SW from taking effect

## Changes

### 1. `src/main.tsx` — Add SW unregistration guard (top of file, before anything else)

Add this block before the existing service worker code:

```typescript
// Guard: prevent service workers in Lovable preview/iframe contexts
const isInIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();

const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com") ||
  window.location.hostname.includes("lovable.app");

if (isPreviewHost || isInIframe) {
  // Unregister any existing service workers that may be serving stale offline pages
  navigator.serviceWorker?.getRegistrations().then((registrations) => {
    registrations.forEach((r) => r.unregister());
  });
}
```

Then wrap the existing SW initialization block (lines 31-58) so it only runs when NOT in a preview/iframe context.

### 2. `vite-pwa-config.ts` — Disable SW in dev mode

Add `devOptions: { enabled: false }` to prevent SW registration during development.

## What This Fixes

- Immediately clears the stuck offline page from the preview
- Prevents the service worker from re-registering in preview contexts
- Production (published) PWA continues to work normally

