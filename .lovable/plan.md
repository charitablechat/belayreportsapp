
What I know now

- The blue offline screen in your screenshot is not coming from the current source code. I searched the repo and those strings are not in `src` or `public`.
- Do I know what the issue is? Yes. A stale service-worker-controlled build is still owning the preview origin and serving an old offline shell before the current app boots.
- The earlier fix was only partial: `vite-plugin-pwa` still uses `injectRegister: 'script-defer'`, which can register outside React, and `unregister()` alone does not clear Cache Storage or force the stale page to be replaced.

Files to isolate

- `vite-pwa-config.ts`
- `index.html`
- `src/main.tsx`
- `src/lib/environment.ts`
- `src/hooks/usePWAUpdate.tsx`

Implementation plan

1. Stop automatic head-based SW registration
- In `vite-pwa-config.ts`, change PWA registration from auto-injected (`injectRegister: 'script-defer'`) to manual registration.
- Keep `devOptions.enabled = false`.

2. Add an early preview cleanup script
- In `index.html`, add a tiny inline script that runs before React and, only in preview/iframe:
  - unregisters all service workers
  - deletes all Cache Storage entries
  - reloads once after cleanup
- This gives the preview a way to escape the stale offline shell before the app starts.

3. Centralize preview detection
- In `src/lib/environment.ts`, add one shared helper for “preview/iframe” and one for “service worker allowed”.
- Use exact preview checks (`id-preview--`, `lovableproject.com`, iframe).
- Remove the broad `lovable.app` check so the published site can still use PWA features.

4. Manually register the PWA only where allowed
- In `src/main.tsx`, use `virtual:pwa-register` and register only when not in preview/iframe.
- Keep the auth-token-to-service-worker logic only inside that allowed branch.

5. Keep the PWA UI in sync with the same rule
- Update `src/hooks/usePWAUpdate.tsx` to use the shared environment helper so preview never behaves like a PWA environment.

Fallback if the stale shell survives one deploy

- Do a one-time cleanup deploy with `selfDestroying: true` in the PWA config to forcibly replace and erase the old worker/caches, then remove that flag after the preview is clean.

Expected result

- The Lovable preview loads the current app instead of the old blue offline card.
- The published app keeps install/offline behavior.
- Future preview sessions will not get trapped by stale service-worker caches again.
