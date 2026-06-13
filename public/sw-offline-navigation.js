// Redundant navigation shell + asset cache for cold-start offline launches.
//
// This script is imported BEFORE Workbox via `importScripts` in the generated
// service worker, so its `fetch` listener gets the first crack at navigation
// requests. It implements:
//
//   1. Network-first-with-shell-fallback for HTML navigations.
//   2. Cache-first-with-network-mirror for same-origin hashed assets
//      (`/assets/*`, `/icons/*`, manifest, sw-* scripts, fonts), so that
//      once a page has loaded online the JS/CSS bundles required to mount
//      React are guaranteed to be in OUR cache for the next offline launch
//      — independent of Workbox precache timing (which races
//      `skipWaiting` + `clientsClaim` and can leave the precache cache
//      empty when the test/user goes offline immediately after first load).
//
// Critical rule: when offline, navigations MUST resolve to the React app
// shell (cached `/index.html` or `/`). The static `/offline.html` page is a
// last-resort recovery surface only — never the primary fallback. Returning
// `/offline.html` for a normal SPA navigation traps users on a black "You're
// offline" screen they cannot escape because the app shell never mounts.
(function () {
  var CACHE_NAME = 'rw-navigation-shell-v3';
  // Order matters: SHELL_URLS[0] is the canonical shell entry. `/offline.html`
  // is intentionally NOT in this list — it lives in Workbox precache and is
  // only consulted by `lastResortShell()` when no app shell is reachable.
  var SHELL_URLS = ['/index.html', '/'];

  function isNavigationRequest(event) {
    return event && event.request && event.request.mode === 'navigate';
  }

  function shouldHandleNavigation(url) {
    if (url.origin !== self.location.origin) return false;
    if (url.pathname.indexOf('/api') === 0) return false;
    if (url.pathname.indexOf('/~oauth') === 0) return false;
    if (url.pathname === '/version.json') return false;
    return true;
  }

  // Same-origin hashed-asset request? These are content-addressed
  // (filename includes a hash) so cache-first is safe forever.
  function isHashedAssetRequest(request, url) {
    if (request.method !== 'GET') return false;
    if (url.origin !== self.location.origin) return false;
    var p = url.pathname;
    if (p === '/version.json') return false;
    if (p.indexOf('/assets/') === 0) return true;
    if (p.indexOf('/icons/') === 0) return true;
    if (p === '/favicon.ico' || p === '/favicon.png') return true;
    if (p === '/manifest.webmanifest' || p === '/manifest.json') return true;
    if (/\.(?:js|mjs|css|woff2?|ttf|otf|png|jpg|jpeg|svg|gif|webp|avif)$/i.test(p)) return true;
    return false;
  }

  // Fetch and cache the app shell on install so cold-start offline launches
  // always have something to serve. Best-effort — Workbox precache also
  // covers index.html, so a failure here is not fatal.
  async function cacheShell() {
    var cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL_URLS.map(async function (url) {
      try {
        var response = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
        if (response && response.ok) {
          await cache.put(url, response.clone());
        }
      } catch (error) {
        // Best effort only.
      }
    }));
  }

  // Mirror successful HTML responses into our shell cache under stable keys
  // (`/`, `/index.html`, plus the actual request URL) so the next offline
  // navigation has a known-good copy to return regardless of route.
  async function putNavigationResponse(request, response) {
    if (!response || !response.ok || response.type === 'opaque') return;
    var contentType = response.headers.get('content-type') || '';
    if (contentType.indexOf('text/html') === -1) return;
    try {
      var cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
      await cache.put('/', response.clone());
      await cache.put('/index.html', response.clone());
    } catch (error) {
      // ignore quota / opaque-response errors
    }
  }

  // Mirror successful asset responses into our cache. Best-effort.
  async function putAssetResponse(request, response) {
    if (!response || !(response.ok || response.type === 'opaque')) return;
    try {
      var cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    } catch (error) {
      // ignore quota errors
    }
  }

  // Try every cache (ours + Workbox precache + runtime) for the SPA shell.
  // Returns null if no shell is anywhere — only then does the caller fall
  // back to the static offline.html recovery page.
  async function findShellResponse(url) {
    var candidates = [url.pathname + url.search, url.pathname].concat(SHELL_URLS);
    var cacheNames = await caches.keys();
    for (var i = 0; i < candidates.length; i += 1) {
      var key = candidates[i];
      var ownMatch = await caches.match(key, { ignoreSearch: true });
      if (ownMatch) return ownMatch;
      for (var j = 0; j < cacheNames.length; j += 1) {
        try {
          var cache = await caches.open(cacheNames[j]);
          var match = await cache.match(key, { ignoreSearch: true });
          if (match) return match;
        } catch (e) { /* ignore */ }
      }
    }
    return null;
  }

  // Search every cache for a same-origin asset. Used when our own cache
  // hasn't been warmed yet but Workbox precache or runtime has the file.
  async function findAssetResponse(request) {
    var ownMatch = await caches.match(request, { ignoreSearch: false });
    if (ownMatch) return ownMatch;
    var cacheNames = await caches.keys();
    for (var i = 0; i < cacheNames.length; i += 1) {
      try {
        var cache = await caches.open(cacheNames[i]);
        var match = await cache.match(request, { ignoreSearch: false });
        if (match) return match;
        match = await cache.match(request.url, { ignoreSearch: true });
        if (match) return match;
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  // Last-resort recovery: only used when NO app shell exists in any cache.
  // Tries the static offline.html (precached by Workbox + includeAssets), and
  // finally synthesises a minimal HTML response that points users back at the
  // app shell route.
  async function lastResortShell() {
    var offline = await caches.match('/offline.html', { ignoreSearch: true });
    if (offline) return offline;
    return new Response(
      '<!doctype html><title>Belay Reports</title><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="1; url=/"><body style="font-family:-apple-system,sans-serif;background:#0b0f17;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center"><div><h1 style="font-size:18px;margin:0 0 8px">Belay Reports</h1><p style="margin:0;font-size:14px;color:#cbd5e1">Loading the app…</p></div></body>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  // Warm CACHE_NAME with a batch of URLs reported from a controlled page
  // (see `src/main.tsx` post-load handshake). Best-effort.
  async function warmAssets(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return;
    var cache = await caches.open(CACHE_NAME);
    await Promise.all(urls.map(async function (raw) {
      try {
        var url = new URL(raw, self.location.origin);
        if (url.origin !== self.location.origin) return;
        var request = new Request(url.toString(), { credentials: 'same-origin' });
        var existing = await cache.match(request);
        if (existing) return;
        var response = await fetch(request);
        if (response && (response.ok || response.type === 'opaque')) {
          await cache.put(request, response.clone());
        }
      } catch (error) {
        // best effort
      }
    }));
  }

  self.addEventListener('install', function (event) {
    event.waitUntil(cacheShell());
  });

  self.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || data.type !== 'warm-assets') return;
    event.waitUntil(warmAssets(data.urls || []));
  });

  self.addEventListener('fetch', function (event) {
    var request = event.request;
    var url;
    try { url = new URL(request.url); } catch (e) { return; }

    if (isNavigationRequest(event)) {
      if (!shouldHandleNavigation(url)) return;
      event.respondWith((async function () {
        try {
          var preload = await event.preloadResponse;
          if (preload) {
            await putNavigationResponse(request, preload.clone());
            return preload;
          }
        } catch (error) { /* fall through to network */ }
        try {
          var response = await fetch(request);
          await putNavigationResponse(request, response.clone());
          return response;
        } catch (error) {
          var shell = await findShellResponse(url);
          if (shell) return shell;
          return await lastResortShell();
        }
      })());
      return;
    }

    if (isHashedAssetRequest(request, url)) {
      event.respondWith((async function () {
        // Cache-first: serve from our cache, OR any other cache that has it.
        var cached = await findAssetResponse(request);
        if (cached) {
          // Refresh in the background so newer hashed builds still cache.
          event.waitUntil((async function () {
            try {
              var fresh = await fetch(request);
              await putAssetResponse(request, fresh);
            } catch (e) { /* offline — keep cached copy */ }
          })());
          return cached;
        }
        // Network-first when we've never seen it; mirror on success.
        try {
          var response = await fetch(request);
          await putAssetResponse(request, response.clone());
          return response;
        } catch (error) {
          // Final attempt: search all caches once more (race with another
          // SW handler that just populated precache).
          var retry = await findAssetResponse(request);
          if (retry) return retry;
          throw error;
        }
      })());
      return;
    }
  });
})();
