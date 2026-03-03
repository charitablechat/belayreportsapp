

## Disable Automatic Update Reloads — User-Initiated Only

### Problem

There are **two** places that auto-reload the page when a new service worker activates, bypassing user consent:

1. **`src/components/pwa/UpdateNotification.tsx`** — Listens for `controllerchange` and calls `window.location.reload()` unconditionally.
2. **`src/hooks/usePWAUpdate.tsx` (line 63-68)** — Also listens for `controllerchange` and calls `window.location.reload()`.

Both fire the moment a new service worker takes control, which can happen in the background without user action. This disrupts active workflows.

### Fix

#### 1. Remove auto-reload from `UpdateNotification.tsx`

Replace the auto-reload `controllerchange` listener with a component that renders nothing (or a visible banner — see step 3). The component currently renders `null` and only exists for its side effect of reloading; that side effect is removed.

#### 2. Remove auto-reload from `usePWAUpdate.tsx`

Remove the `controllerchange` -> `window.location.reload()` listener (lines 63-68, 70, 95-96). Instead, when `controllerchange` fires, just set `needRefresh` to `true` so the existing `UpdateBadge` appears. The reload only happens when the user explicitly clicks "Apply Update" in the `UpdateControlPanel`.

#### 3. Add a prominent update banner to `UpdateNotification.tsx`

Convert the empty component into a visible, fixed-position banner that appears when `needsUpdate` is true. The banner will:
- Be fixed at the top of the viewport, full-width, high-contrast (black background, amber text, monospace font — matching the existing Minimal Brutalism aesthetic)
- Display: "UPDATE AVAILABLE — v{version}"
- Include an "Install Update" button that calls `updateAndReload()`
- Include a dismiss "X" button that hides the banner for that session
- Be non-intrusive (does not block interaction with the app beneath)

This uses the existing `usePWA()` hook which already exposes `needsUpdate` and `updateAndReload`.

### Files Changed

| File | Change |
|------|--------|
| `src/hooks/usePWAUpdate.tsx` | Remove `controllerchange` auto-reload; set `needRefresh = true` instead |
| `src/components/pwa/UpdateNotification.tsx` | Replace auto-reload with a visible update banner using `usePWA()` |

### What Stays the Same

- `UpdateBadge` and `UpdateControlPanel` continue to work as before (amber dot in header, CRT-styled panel)
- Background update checking interval (hourly) is unchanged
- `updateServiceWorker()` still sends `SKIP_WAITING` and reloads — but only when the user clicks "Apply Update" or "Install Update"
- No changes to service worker registration, offline storage, or sync logic

