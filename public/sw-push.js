// Push notification handler for service worker
const isDev = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

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
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[Service Worker] Received SKIP_WAITING, activating new version');
    self.skipWaiting();
  }
});
