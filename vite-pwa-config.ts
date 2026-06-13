import { VitePWA } from 'vite-plugin-pwa';

/**
 * VitePWA configuration — Phase 2 (autoUpdate).
 *
 * Why autoUpdate + manual guarded registration?
 * - autoUpdate: VitePWA's runtime auto-activates new SWs without user prompt
 *   once installed. Combined with our soft-refresh banner (StaleVersionBanner)
 *   this delivers updates reliably across iOS/Android/Windows.
 * - injectRegister:false: src/main.tsx registers the SW only on real production
 *   pages, never in Lovable preview iframes.
 *
 * updateViaCache:'none' is critical for iOS Safari, which otherwise pins the
 * SW script in HTTP cache for 24h delaying every update. With 'none', the
 * browser MUST revalidate the SW script on every navigation.
 *
 * /version.json is excluded from precache and runtime cache so the
 * server-side version-check polling always reads the live deployed value.
 */
export const pwaConfig = VitePWA({
  registerType: 'autoUpdate',
  injectRegister: false,
  devOptions: {
    enabled: false,
  },
  includeAssets: ['favicon.ico', 'db-config.js', 'sw-push.js', 'sw-sync.js', 'sw-offline-navigation.js', 'offline.html'],
  manifest: {
    id: '/',
    name: 'Belay Reports',
    short_name: 'Belay Reports',
    description: 'Professional digital inspection platform for aerial adventure programs',
    theme_color: '#1e40af',
    background_color: '#0b0f17',
    display: 'standalone',
    // PR-B: richer install metadata previously stranded in the orphan
    // public/manifest.json. VitePWA's generated manifest.webmanifest is the
    // only manifest the SW serves; the static public/manifest.json was never
    // referenced from index.html so its contents never reached users.
    display_override: ['window-controls-overlay', 'standalone'],
    orientation: 'any',
    scope: '/',
    start_url: '/',
    categories: ['business', 'productivity', 'utilities'],
    prefer_related_applications: false,
    handle_links: 'preferred',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    // Shortcut URLs MUST match the routes registered in src/App.tsx.
    // The orphan public/manifest.json had wrong paths (/new-inspection,
    // /new-training) that would have broken every long-press shortcut had
    // anything actually served that file. Fixed here on the way in.
    shortcuts: [
      {
        name: 'New Inspection',
        short_name: 'Inspection',
        description: 'Start a new inspection report',
        url: '/inspection/new',
        icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }]
      },
      {
        name: 'New Training',
        short_name: 'Training',
        description: 'Start a new training report',
        url: '/training/new',
        icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }]
      },
      {
        name: 'Dashboard',
        short_name: 'Dashboard',
        description: 'View all reports',
        url: '/dashboard',
        icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }]
      }
    ]
  },
  workbox: {
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    // Take control of all clients immediately so the very first install
    // can serve the app shell offline without requiring a second navigation.
    clientsClaim: true,
    skipWaiting: true,
    cleanupOutdatedCaches: true,
    navigationPreload: true,
    // Exclude version.json from precache — it must always be fresh
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,avif}'],
    globIgnores: ['**/version.json'],
    // Workbox-native SPA navigation fallback. `sw-offline-navigation.js` runs
    // FIRST (imported before Workbox) and handles the network-first-then-
    // shell flow for every navigation, but we keep this fallback enabled as a
    // backstop so any navigation that escapes the custom handler (race with
    // SW install, edge-cased route) still resolves to the React app shell
    // instead of the browser's native "You're offline" surface.
    //
    // Denylist the small set of paths that must NEVER be served the SPA
    // shell: OAuth callbacks, the always-fresh version probe, and any
    // future API-style routes. Everything else (`/`, `/dashboard`,
    // `/inspection/:id`, etc.) gets `/index.html` and React Router takes
    // over once the bundle hydrates.
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//, /^\/version\.json$/],
    importScripts: ['/sw-offline-navigation.js', '/db-config.js', '/sw-push.js', '/sw-sync.js'],
    runtimeCaching: [
      {
        // version.json: never cache — always go to network
        urlPattern: /\/version\.json$/,
        handler: 'NetworkOnly',
      },
      {
        urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'supabase-cache',
          expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
          cacheableResponse: { statuses: [0, 200] }
        }
      },
      {
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'image-cache',
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }
        }
      },
      {
        urlPattern: /\.(?:woff|woff2|ttf|otf)$/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'font-cache',
          expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }
        }
      }
    ]
  }
});
