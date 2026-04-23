// Push notification handler for service worker
const isDev = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

const SW_LOG_PREFIX = '[SW Push]';
const JWT_SHAPE = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * C6: Validate that a postMessage came from a same-origin window client.
 * Returns true if the message should be processed.
 */
function isMessageFromTrustedSource(event) {
  const source = event.source;
  if (!source || source.type !== 'window') {
    if (isDev) console.warn(SW_LOG_PREFIX, 'rejected message: source is not a window client', source && source.type);
    return false;
  }
  try {
    const sourceUrl = source.url;
    if (!sourceUrl) {
      if (isDev) console.warn(SW_LOG_PREFIX, 'rejected message: source has no url');
      return false;
    }
    const sourceOrigin = new URL(sourceUrl).origin;
    if (sourceOrigin !== self.location.origin) {
      if (isDev) console.warn(SW_LOG_PREFIX, 'rejected message: cross-origin source', sourceOrigin);
      return false;
    }
  } catch (e) {
    if (isDev) console.warn(SW_LOG_PREFIX, 'rejected message: failed to validate source url', e);
    return false;
  }
  return true;
}

self.addEventListener('push', (event) => {
  if (isDev) console.log('[Service Worker] Push notification received:', event);

  if (!event.data) {
    if (isDev) console.log('[Service Worker] Push event has no data');
    return;
  }

  try {
    const data = event.data.json();
    if (isDev) console.log('[Service Worker] Push notification data:', data);

    const options = {
      body: data.body,
      icon: data.icon || '/icons/icon-192.png',
      badge: data.badge || '/icons/icon-192-maskable.png',
      data: data.data || {},
      vibrate: [200, 100, 200],
      tag: data.data?.inspectionId || 'default',
      requireInteraction: false,
    };

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  } catch (error) {
    if (isDev) console.error('[Service Worker] Error parsing push notification:', error);
  }
});

self.addEventListener('notificationclick', (event) => {
  if (isDev) console.log('[Service Worker] Notification clicked:', event);
  
  event.notification.close();

  // Handle navigation based on notification data
  const data = event.notification.data;
  let url = '/dashboard';

  if (data.inspectionId) {
    url = `/inspection/${data.inspectionId}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window open
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open a new window
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

self.addEventListener('notificationclose', (event) => {
  if (isDev) console.log('[Service Worker] Notification closed:', event);
});

// Handle update messages from the app
self.addEventListener('message', (event) => {
  // C6: reject messages from non-window or cross-origin sources
  if (!isMessageFromTrustedSource(event)) return;

  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SKIP_WAITING') {
    console.log('[Service Worker] Received SKIP_WAITING, activating new version');
    self.skipWaiting();
    return;
  }

  // C6: validate AUTH_TOKEN payload shape (defense-in-depth — sw-push doesn't
  // currently use the token, but harden the handler for future use).
  if (data.type === 'AUTH_TOKEN') {
    const token = data.accessToken;
    if (typeof token !== 'string' || !JWT_SHAPE.test(token) || token === 'offline_placeholder_token') {
      console.warn(SW_LOG_PREFIX, 'rejected message: AUTH_TOKEN failed shape validation');
      return;
    }
    // Currently unused in sw-push.js — sw-sync.js owns the cached token.
  }
});
