// Redundant navigation shell cache for cold-start offline launches.
// This runs before Workbox's generated routes because it is imported at the
// top of sw.js. It gives the installed PWA a simple network-first document
// handler and a fallback cache that is independent from Workbox internals.
(function () {
  var CACHE_NAME = 'rw-navigation-shell-v1';
  var SHELL_URLS = ['/', '/index.html', '/offline.html'];

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

  async function cacheShell() {
    var cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL_URLS.map(async function (url) {
      try {
        var response = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
        if (response && response.ok) {
          await cache.put(url, response.clone());
        }
      } catch (error) {
        // Best effort only. Workbox precache still runs after this script.
      }
    }));
  }

  async function putNavigationResponse(request, response) {
    if (!response || !response.ok || response.type === 'opaque') return;
    var contentType = response.headers.get('content-type') || '';
    if (contentType.indexOf('text/html') === -1) return;
    var cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
    await cache.put('/', response.clone());
    await cache.put('/index.html', response.clone());
  }

  async function matchFromAnyCache(url) {
    var candidates = [url.pathname + url.search, url.pathname, '/index.html', '/', '/offline.html'];
    var cacheNames = await caches.keys();
    for (var i = 0; i < candidates.length; i += 1) {
      var request = candidates[i];
      var ownMatch = await caches.match(request, { ignoreSearch: true });
      if (ownMatch) return ownMatch;
      for (var j = 0; j < cacheNames.length; j += 1) {
        var cache = await caches.open(cacheNames[j]);
        var match = await cache.match(request, { ignoreSearch: true });
        if (match) return match;
      }
    }
    return new Response(
      '<!doctype html><title>Rope Works Offline</title><meta name="viewport" content="width=device-width,initial-scale=1"><body><h1>Rope Works is offline</h1><p>Open the app once online to finish offline setup.</p></body>',
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
        return matchFromAnyCache(url);
      }
    })());
  });
})();