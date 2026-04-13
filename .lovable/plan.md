

# Fix: Stale Service Worker Still Blocking Preview (Root Cause Found)

## The Real Problem

The previous fixes added cleanup logic to `index.html` and `src/main.tsx`, but **those files never load**. Here is why:

```text
1. Browser requests /  (preview iframe)
2. Stale SW intercepts via navigateFallback: '/'
3. SW serves OLD cached index.html (with the "You're Offline" page)
4. NEW index.html (with cleanup script) never reaches the browser
```

The stale service worker was registered from a previous production build on the `id-preview--*.lovable.app` origin. It owns all navigation requests and serves cached content before the dev server can respond. The cleanup script we added to `index.html` is useless because the SW prevents that file from ever loading.

The strings "Available Offline Features", "No internet connection detected", "Capture GPS coordinates" do not exist anywhere in the current codebase, confirming this is entirely served from an old SW cache.

## Solution: Self-Destroying Service Worker

Create a `public/sw.js` file that acts as a **self-destroying service worker**. When the stale SW performs its periodic update check (or when the browser fetches `/sw.js`), it will find this new file, install it, and the new SW will immediately unregister itself and clear all caches.

## Changes

### 1. Create `public/sw.js` — Self-destroying service worker

A minimal SW that, upon installation, skips waiting and immediately unregisters itself and clears all caches:

```javascript
// Self-destroying service worker — clears stale caches from previous builds
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(event) {
  event.waitUntil(
    Promise.all([
      self.registration.unregister(),
      caches.keys().then(function(keys) {
        return Promise.all(keys.map(function(k) { return caches.delete(k); }));
      })
    ]).then(function() {
      return self.clients.matchAll();
    }).then(function(clients) {
      clients.forEach(function(c) { c.navigate(c.url); });
    })
  );
});
```

### 2. Update `index.html` cleanup script — Force SW update check

Enhance the existing cleanup script to also explicitly fetch `/sw.js` to trigger the stale SW to update to the self-destroying version, as a belt-and-suspenders approach alongside the existing unregister logic.

### 3. No other file changes needed

The `vite-pwa-config.ts`, `src/main.tsx`, and `src/lib/environment.ts` changes from the previous fix remain correct and do not need modification.

## Why This Works

- The stale SW periodically checks for updates to its script URL (`/sw.js`)
- The dev server will serve our new `public/sw.js` instead of the old cached one
- The byte-difference triggers the browser to install the new SW
- The new SW immediately kills itself and clears all caches
- The next navigation loads the real app from the dev server

## After Preview Is Fixed

Once the preview is working again, the `public/sw.js` file should remain in place as a permanent safety net. In production builds, `vite-plugin-pwa` generates its own `sw.js` which will overwrite this file in the build output, so it will not interfere with production PWA functionality.

