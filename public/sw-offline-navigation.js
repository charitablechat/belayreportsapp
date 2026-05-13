// Redundant navigation shell cache for cold-start offline launches.
//
// This script is imported BEFORE Workbox via `importScripts` in the generated
// service worker, so its `fetch` listener gets the first crack at navigation
// requests. It implements network-first-with-shell-fallback for HTML
// navigations.
//
// Critical rule: when offline, navigations MUST resolve to the React app
// shell (cached `/index.html` or `/`). The static `/offline.html` page is a
// last-resort recovery surface only — never the primary fallback. Returning
// `/offline.html` for a normal SPA navigation traps users on a black "You're
// offline" screen they cannot escape because the app shell never mounts.
(function () {
  var CACHE_NAME = 'rw-navigation-shell-v2';
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

  // Last-resort recovery: only used when NO app shell exists in any cache.
  // Tries the static offline.html (precached by Workbox + includeAssets), and
  // finally synthesises a minimal HTML response that points users back at the
  // app shell route.
  async function lastResortShell() {
    var offline = await caches.match('/offline.html', { ignoreSearch: true });
    if (offline) return offline;
    return new Response(
      '<!doctype html><title>Rope Works</title><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="1; url=/"><body style="font-family:-apple-system,sans-serif;background:#0b0f17;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center"><div><h1 style="font-size:18px;margin:0 0 8px">Rope Works</h1><p style="margin:0;font-size:14px;color:#cbd5e1">Loading the app…</p></div></body>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  self.addEventListener('install', function (event) {
    event.waitUntil(cacheShell());
  });

  self.addEventListener('fetch', function (event) {
    if (!isNavigationRequest(event)) return;
    var url = new URL(event.request.url);
    if (!shouldHandleNavigation(url)) return;

    event.respondWith((async function () {
      try {
        var preload = await event.preloadResponse;
        if (preload) {
          await putNavigationResponse(event.request, preload.clone());
          return preload;
        }
      } catch (error) {
        // Ignore preload failures and try the network below.
      }

      try {
        var response = await fetch(event.request);
        await putNavigationResponse(event.request, response.clone());
        return response;
      } catch (error) {
        var shell = await findShellResponse(url);
        if (shell) return shell;
        return await lastResortShell();
      }
    })());
  });
})();
