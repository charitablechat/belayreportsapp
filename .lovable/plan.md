

## Fix: PWA "INSTALL UPDATE" Button Non-Functional

### Root Cause

There is a conflict between the PWA configuration and the manual update UI:

1. **`vite-pwa-config.ts`** sets `registerType: 'autoUpdate'` with `skipWaiting: true` and `clientsClaim: true`
2. This means every new service worker **immediately activates** — there is never a `waiting` worker
3. The `controllerchange` event fires → `needRefresh` becomes `true` → banner shows
4. User clicks "INSTALL UPDATE" → `updateServiceWorker(true)` runs → checks `registration?.waiting` → **it's null** (SW already activated itself)
5. Falls through to `window.location.reload()` → page reloads → `controllerchange` fires again → banner reappears

**The button reloads the page, but the update was already applied before the user even saw the banner.** The banner then reappears on reload because the same `controllerchange` pattern repeats if any cache difference is detected.

### Fix (2 files)

**1. `vite-pwa-config.ts`** — Change to `prompt` mode, remove auto-skip:
- `registerType: 'prompt'` (user controls activation)
- Remove `skipWaiting: true` and `clientsClaim: true`
- This ensures new SWs **wait** until the user clicks "INSTALL UPDATE"

**2. `src/hooks/usePWAUpdate.tsx`** — Harden the update flow:
- After posting `SKIP_WAITING`, listen for `controllerchange` before reloading (instead of a blind 500ms timeout)
- Add a `controllerchange` one-shot listener that triggers reload, with a 3s safety timeout
- Clear `needRefresh` when the update completes so the banner doesn't reappear

### Result
- New SW installs → enters `waiting` state → banner shows
- User clicks "INSTALL UPDATE" → `SKIP_WAITING` posted → SW activates → page reloads
- After reload: no waiting worker, no controllerchange → banner gone
- Orange styling preserved (no CSS changes)
- Works identically on desktop and mobile (SW API is cross-platform)

