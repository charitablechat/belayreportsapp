import { VitePWA } from 'vite-plugin-pwa';

export const pwaConfig = VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['favicon.ico', 'sw-push.js', 'sw-sync.js'],
  manifest: {
    name: 'Rope Works Inspection',
    short_name: 'RW Inspect',
    description: 'Professional digital inspection platform for aerial adventure programs',
    theme_color: '#1e40af',
    background_color: '#ffffff',
    display: 'standalone',
    orientation: 'portrait',
    scope: '/',
    start_url: '/',
    icons: [
      {
        src: 'icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: 'icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: 'icons/icon-192-maskable.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable'
      },
      {
        src: 'icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ]
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
    navigateFallback: '/offline.html',
    navigateFallbackDenylist: [/^\/api/],
    importScripts: ['/sw-push.js', '/sw-sync.js'],
    runtimeCaching: [
      // API calls - Network first with 1 hour cache
      {
        urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'supabase-cache',
          expiration: {
            maxEntries: 50,
            maxAgeSeconds: 60 * 60 // 1 hour
          },
          cacheableResponse: {
            statuses: [0, 200]
          }
        }
      },
      // Images - Cache first with 30 day expiration
      {
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'image-cache',
          expiration: {
            maxEntries: 100,
            maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
          }
        }
      },
      // Fonts - Cache first with 1 year expiration
      {
        urlPattern: /\.(?:woff|woff2|ttf|otf)$/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'font-cache',
          expiration: {
            maxEntries: 20,
            maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
          }
        }
      }
    ]
  }
});
