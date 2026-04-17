

The user is asking specifically about **update delivery gaps** on Apple platforms (macOS Safari, iPadOS, iOS) — i.e. what stops users from getting the latest version of the PWA reliably. This is narrower than the previous general iOS audit. Focus on service worker update delivery, cache busting, and version visibility.

Let me think through Apple-specific update gaps:

## Known Apple update-delivery gaps

1. **iOS Safari aggressive HTTP caching of `index.html`** — even with SW updates, Safari may serve a stale `index.html` from HTTP cache, so the SW never sees the new build. Need `Cache-Control: no-cache` on HTML and SW files (Lovable hosting may already handle, but worth verifying via meta tags).

2. **Service Worker `updateViaCache`** — by default browsers may cache the SW script itself for 24h. Setting `updateViaCache: 'none'` on registration forces a network check every time. Need to verify in `vite-pwa-config.ts` / SW registration.

3. **macOS Safari multi-tab SW activation** — `skipWaiting` + `clients.claim` works, but if the user has multiple tabs open the new SW won't activate until all tabs close. No reload prompt is shown across other tabs.

4. **iOS standalone PWA never reloads on its own** — when the user swipes the PWA away from app switcher and reopens, iOS sometimes restores from snapshot without re-running JS. The foreground update check I added helps, but we never *force* the user to update — `needsUpdate` just sets a flag. There's no visible "Update available" banner that I can confirm exists in the header.

5. **Hard-refresh impossible in standalone PWA on iOS** — there's no pull-to-refresh, no reload button. If SW gets wedged, user has no recovery. Need a visible "Reload app" affordance.

6. **Cached API responses via SW** — if Workbox runtime caching is too aggressive, iOS users get stale data. Need to confirm Supabase API calls are network-first or not cached.

7. **Version mismatch invisibility** — `version.json` exists and `VersionBadge` exists, but is it actually shown? Does the user know what version they're on vs. what's available?

8. **`apple-mobile-web-app-capable` + status bar** — affects the standalone shell, but if the manifest changes and the user has an old icon installed, iOS does NOT update the home screen icon or splash screen. Only fix is reinstall. Worth noting as a known iOS limitation, not really fixable.

9. **iOS 16.4+ web push requires re-permission after PWA reinstall** — affects update perception ("notifications stopped working").

10. **Service worker `navigationPreload`** — speeds up updates but unsupported on Safari < 16.4.

## Files to read for the audit

- `vite-pwa-config.ts` — check `updateViaCache`, `skipWaiting`, `clientsClaim`, runtime caching strategies
- `index.html` — check cache-control meta tags, apple-touch-icon, manifest link
- `public/sw.js` and other SW files — confirm fetch handler caching strategies
- `src/main.tsx` — check SW registration call and `updateViaCache` option
- `src/components/AuthenticatedHeader.tsx` — does an "Update available" banner show?
- `src/components/pwa/UpdateNotification.tsx` and `UpdateBadge.tsx` — already exist, verify they're mounted and visible
- `src/components/pwa/ManualUpdateButton.tsx` — exists, verify discoverability
- `public/manifest.json` — verify

## Deliverable

After approval I'll:
1. Read the files above (parallel).
2. Categorize each of the 10 gaps as ✅ handled / ⚠️ partial / ❌ gap.
3. For each ⚠️/❌, propose a concrete one-line fix and target file.
4. Group fixes into a single batch the user can approve with "yes, fix it all" again.

## Likely fixes I expect to propose (subject to audit)

- Add `updateViaCache: 'none'` to SW registration (forces fresh SW script check)
- Add `<meta http-equiv="Cache-Control" content="no-cache">` to `index.html` so iOS Safari doesn't pin a stale shell
- Mount a persistent "Update available — tap to reload" banner using existing `UpdateNotification` if not already in `RootLayout`
- Add a "Force reload app" button in the iOS Sync Diagnostics sheet (already created) so wedged-PWA users have recovery
- Verify Workbox runtime caching is `NetworkFirst` (not `CacheFirst`) for API and HTML
- Show current version + "latest available" version in `SyncDiagnosticsSheet` so users can self-verify they're up to date

This is a focused 30–60 min audit + fix cycle, all client-side, no backend changes.

