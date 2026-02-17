

# Fix Version Mismatch: PWA Cache Staleness + Retro-Tech Version Badge

## Root Cause

The version string (`2.5.1`) is correctly defined in `vite.config.ts` and injected at build time via Vite's `define` option. The `VersionBadge` and `VersionInfoModal` components read it correctly from `import.meta.env.APP_VERSION`.

The mismatch users see is caused by **PWA service worker caching**:

1. Workbox caches JS/CSS/HTML bundles (`globPatterns: ['**/*.{js,css,html,...}']`)
2. `registerType: 'autoUpdate'` detects new SW versions but the cached JS bundle (containing the old version string) can persist until the new SW fully activates and the page reloads
3. Users who keep the app open or navigate without a hard refresh continue seeing the stale version

## Changes

### 1. Force Cache-Busting on SW Update (`vite-pwa-config.ts`)

Add `skipWaiting: true` and `clientsClaim: true` to the Workbox config. This ensures the new service worker activates immediately on detection, replacing stale cached assets without waiting for all tabs to close.

```
workbox: {
  skipWaiting: true,
  clientsClaim: true,
  // ...existing config
}
```

### 2. Auto-Reload on SW Controller Change (`src/components/pwa/UpdateNotification.tsx`)

Add a `controllerchange` listener that automatically reloads the page when the new SW takes control. This eliminates the window where stale JS serves the old version:

```typescript
useEffect(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }
}, []);
```

### 3. Retro-Tech Terminal Styling for VersionBadge (`src/components/VersionBadge.tsx`)

Update the badge styling to match the Retro-Tech Terminal aesthetic:

- Default state: `text-zinc-500 font-mono border-zinc-700` (low-contrast terminal text)
- Hover state: `text-green-400 border-green-500/50 shadow-[0_0_8px_rgba(34,197,94,0.3)]` (green CRT glow)
- Add a subtle CRT scanline overlay via a pseudo-element or inline background

### 4. Retro-Tech Terminal Styling for VersionInfoModal (`src/components/VersionInfoModal.tsx`)

Add CRT scanline overlay to the modal content area using the same green scanline pattern already defined in `index.css`:

- Add a `::before` pseudo-element or an overlay div with the repeating green scanline gradient
- Keep the existing Minimal Brutalist black/white/amber structure
- Add a subtle green glow to the version number display: `text-shadow: 0 0 10px rgba(34,197,94,0.3)`

## Files Modified

| File | Change |
|------|--------|
| `vite-pwa-config.ts` | Add `skipWaiting: true`, `clientsClaim: true` to Workbox config |
| `src/components/pwa/UpdateNotification.tsx` | Add `controllerchange` auto-reload listener |
| `src/components/VersionBadge.tsx` | Retro-Tech Terminal styling with green glow hover |
| `src/components/VersionInfoModal.tsx` | CRT scanline overlay and green text-shadow on version |

## What Does NOT Change

- `vite.config.ts` (version is already correct at 2.5.1)
- Version calculation logic (`src/lib/version-calculator.ts`)
- Form submission, auto-save, or data persistence logic
- Backend, edge functions, RLS policies
- No secrets or API keys affected

