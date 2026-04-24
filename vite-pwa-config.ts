import { VitePWA } from 'vite-plugin-pwa';

/**
 * VitePWA configuration — Phase 2 (autoUpdate).
 *
 * Why autoUpdate + injectRegister:'auto'?
 * - autoUpdate: VitePWA's runtime auto-activates new SWs without user prompt
 *   once installed. Combined with our soft-refresh banner (StaleVersionBanner)
 *   this delivers updates reliably across iOS/Android/Windows.
 * - injectRegister:'auto': lets the plugin inject the SW registration script,
 *   so we don't have to manually call register('/sw.js') in main.tsx (which
 *   was the source of the previous self-destroying-SW conflict).
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
  injectRegister: 'auto',
  devOptions: {
    enabled: false,
  },
  includeAssets: ['favicon.ico', 'db-config.js', 'sw-push.js', 'sw-sync.js'],
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
      { src: 'icons/app-icon.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/app-icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/app-icon.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: 'icons/app-icon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  },
  workbox: {
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    // Exclude version.json from precache — it must always be fresh
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
    globIgnores: ['**/version.json'],
    navigateFallback: '/',
    navigateFallbackDenylist: [/^\/api/, /offline\.html$/, /^\/version\.json$/],
    importScripts: ['/db-config.js', '/sw-push.js', '/sw-sync.js'],
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
