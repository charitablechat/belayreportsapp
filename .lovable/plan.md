

## Android & Windows — first-pass gap audit

Same lens as the iOS pass: API completeness, feature parity, cross-device consistency, OS-version readiness. Only listing gaps that are **real and worth closing**.

---

### Android — real gaps

**B1 — Manifest missing `id` field**

`public/manifest.json` has no `id`. Without it, Chrome on Android keys the installed PWA by `start_url`, so any future change to `start_url` (or hosting domain) creates a duplicate install instead of updating the existing one. Once shipped you can never change it.

**Fix:** add `"id": "/"` to `manifest.json`. Locks identity now while we still can.

---

**B2 — No maskable icon distinct from "any" icon**

Manifest declares the same `app-icon.png` for both `purpose: "any"` and `purpose: "maskable"`. Android adaptive-icon launchers (Pixel, Samsung One UI) crop maskable icons into circles/squircles/teardrops — using a non-maskable source means the logo gets clipped at the edges on most Android launchers.

**Fix:** add a dedicated `app-icon-maskable.png` (logo centered inside the 80% safe zone, padding to edges) and point only the `maskable` entries at it. Keep `any` pointing at the existing icon.

---

**B3 — No `shortcuts` in manifest**

Android (and Windows) long-press on the app icon shows manifest `shortcuts` as a jump list — "New Inspection", "New Training", "Dashboard". We have all three routes; declaring them costs nothing and gives one-tap entry from the home screen.

**Fix:** add a `shortcuts` array to `manifest.json` with 3 entries pointing at `/new-inspection`, `/new-training`, `/dashboard`.

---

**B4 — `categories` and `description` localization missing from manifest**

Chrome's install UI on Android shows `categories` in the Play-Store-style install card (since Chrome 108). Empty array means no category chip. Low-effort credibility win.

**Fix:** add `"categories": ["business", "productivity", "utilities"]` to manifest.

---

**B5 — Android share intent doesn't reach the app (no `share_target`)**

Same gap as iOS A5 — Android supports `share_target` natively in installed PWAs and has since Chrome 71. Inspectors can't share a photo from Google Photos / Files into Rope Works to attach to a report. Listed for completeness; **decision needed** (requires a `/share-receive` route and handler).

---

**B6 — Pull-to-refresh fires even when offline**

`usePullToRefresh` reloads the page on pull. On Android with no connection, that triggers Chrome's "No internet" page over our offline-capable shell, breaking the offline UX. iOS doesn't show this because Safari handles offline differently.

**Fix:** in `usePullToRefresh`, gate the reload on `navigator.onLine`. If offline, trigger our existing sync-events refresh instead and skip `window.location.reload()`.

---

**B7 — No `prefer_related_applications: false` declared**

When set to `false` explicitly, Chrome on Android won't ever try to suggest a "related" Play Store app over the PWA install. Defensive against future Play Store crawler false-matches.

**Fix:** add `"prefer_related_applications": false` to manifest.

---

### Windows — real gaps

**W1 — No `display_override` for window-controls-overlay**

Edge on Windows 11 supports `display_override: ["window-controls-overlay"]`, which lets the app draw under the title bar with native window controls (close/min/max) overlaid. Currently the installed Edge PWA shows a generic chrome title bar wasting ~32px at the top. With our `AuthenticatedHeader` already glassmorphic and full-width, this would look native.

**Fix:** add `"display_override": ["window-controls-overlay", "standalone"]` to manifest. Opt-in CSS in `AuthenticatedHeader` to respect the `env(titlebar-area-*)` safe-area variables when present so our header avoids the overlay buttons. Falls back silently on browsers that don't support it.

---

**W2 — No Edge-specific tile colors**

Windows Start Menu pinning reads `<meta name="msapplication-TileColor">` and `<meta name="msapplication-TileImage">`. Without them, pinned tiles get a default grey background. Cheap fix.

**Fix:** add `<meta name="msapplication-TileColor" content="#0b0f17">` and `<meta name="msapplication-TileImage" content="/icons/app-icon.png">` to `index.html`.

---

**W3 — No `handle_links: "preferred"` for deep links**

When a user clicks an `https://rwreports.com/...` link in Outlook / Teams / Slack on Windows with the PWA installed, Edge defaults to opening it in a new browser tab instead of the installed app. Setting `handle_links: "preferred"` makes Edge route those links into the PWA window.

**Fix:** add `"handle_links": "preferred"` to manifest.

---

**W4 — File-System Access API unused for ZIP exports on desktop**

On Edge/Chrome desktop (Windows + ChromeOS), `window.showSaveFilePicker()` lets the user pick where to save the local ZIP backup instead of dumping it into Downloads. We currently always go through the anchor-download fallback. Real ergonomic upgrade for power users.

**Fix:** in `saveToDevice` (or wherever the ZIP export anchor is created), feature-detect `'showSaveFilePicker' in window` and prefer it on desktop. Keep the existing anchor fallback for browsers that lack it (all of mobile Safari, Firefox).

---

### Cross-device consistency — real gaps

**C1 — Manifest `orientation: "portrait"` blocks landscape on tablets**

Currently locked to `portrait`. On Android tablets and Windows touch devices, this forces the installed PWA to rotate even though the layout works fine in landscape (we already handle landscape on iPad in browser mode). For inspectors filling tables on a Windows tablet in landscape dock, this is annoying.

**Fix:** change `"orientation": "portrait"` → `"orientation": "any"`. Phone users will still naturally hold portrait; tablet users get freedom.

---

**C2 — `background_color` doesn't match dark app shell**

`background_color: "#ffffff"` is what Android shows during the splash flash before JS boots. With our dark UI, users see a white flash → dark app. Same problem iOS A1 fixed for status bar.

**Fix:** change to `"#0b0f17"` to match the dark surface, OR set per-color-scheme via two manifests (overkill — single dark value is enough since we're a dark-first product).

---

### Already solid (don't touch)

- VitePWA `autoUpdate` + version polling works on Chrome/Edge
- `theme-color` light + dark variants (just shipped)
- `apple-mobile-web-app-*` meta tags (just shipped — Android ignores cleanly)
- `viewport-fit=cover, interactive-widget=resizes-content` (Chrome Android honors `interactive-widget`)
- Background sync via `SyncManager` works on Android Chrome
- Push notifications via VAPID work on Android Chrome / Edge / Windows
- `overscroll-behavior: contain` on nested scrollers (just shipped, applies cross-platform; the iOS-only `@supports` guard is a no-op on Android — should we remove it? See below.)

---

### One follow-up from last pass

**F1 — `overscroll-behavior: contain` is iOS-scoped, but the same nested-scroll-vs-page-pull problem exists on Android Chrome**

The previous pass scoped the rule via `@supports (-webkit-touch-callout: none)` because the gap was framed as iOS-specific. It's not — Android Chrome's pull-to-refresh has the identical conflict with our nested table scrollers. The CSS is harmless on Android and would prevent the same edge case there.

**Fix:** drop the `@supports` wrapper so the rule applies cross-platform. Pure CSS deletion.

---

### Out of scope

- **TWA (Trusted Web Activity)** for Play Store distribution — separate decision, requires Play Console account.
- **Windows Store packaged PWA** via PWABuilder — separate decision.
- **Web Share Target** (B5) — same call as iOS A5; skip unless requested.
- **WebAuthn / passkeys** — no current demand.
- **Badging API** for app icon unread counts — nice-to-have, not requested.
- **Periodic Background Sync** — Chrome-only, requires installed PWA + engagement score; current polling fallback is sufficient.

---

### Files to change

- `public/manifest.json` — B1 (`id`), B2 (separate maskable icon entry), B3 (`shortcuts`), B4 (`categories`), B7 (`prefer_related_applications`), W1 (`display_override`), W3 (`handle_links`), C1 (`orientation: any`), C2 (`background_color`)
- `public/icons/app-icon-maskable.png` — new asset (B2), logo centered in 80% safe zone
- `index.html` — W2 (msapplication tile meta tags)
- `src/hooks/usePullToRefresh.tsx` — B6 (`navigator.onLine` gate)
- `src/lib/save-to-device.ts` — W4 (`showSaveFilePicker` preferred path with anchor fallback)
- `src/components/AuthenticatedHeader.tsx` — W1 supporting CSS for `env(titlebar-area-*)` safe areas (~6 lines)
- `src/index.css` — F1 (drop `@supports` wrapper around `.overflow-auto` rule)

No DB migrations. No edge functions. No new dependencies.

### Risk

- **B1 (`id: "/"`)**: must ship before Chrome assigns an implicit one we can't change. If shipped after a different `id` was implied, existing Android installs would orphan. Low risk now since we haven't deviated from `start_url: "/"`.
- **B2 (maskable icon)**: requires a new PNG asset. If the safe-zone padding is wrong, logo gets clipped on adaptive launchers — visually verifiable on any Pixel.
- **C1 (`orientation: any`)**: phone users could rotate into landscape and find some forms cramped. Mitigated because the responsive layout already handles landscape (tested on iPad).
- **C2 (dark `background_color`)**: brief dark splash on light-mode Android. Acceptable since the app itself is dark-first.
- **W1 (window-controls-overlay)**: needs careful CSS — if `AuthenticatedHeader` doesn't respect the title-bar safe area, controls overlap our buttons. Mitigated by feature-detecting and only applying overlay padding when `windowControlsOverlay.visible === true`.
- **W4 (`showSaveFilePicker`)**: secure-context only and requires a user gesture; both already true for export buttons.
- **B6 (offline pull-to-refresh)**: dropping `window.location.reload()` when offline could mask a genuine "I'm online but the page is frozen" case. Mitigated by still firing the sync-events refresh.

### Verification

1. Install PWA on a Pixel — long-press icon → see "New Inspection / New Training / Dashboard" shortcuts.
2. Pull-to-refresh while in airplane mode on Android — no Chrome offline page; sync indicator pulses instead.
3. Install PWA in Edge on Windows 11 — title bar shows native controls overlaid on the dark header, no white chrome strip.
4. Pin tile to Windows Start — tile background is dark, not grey.
5. Click an `https://rwreports.com/dashboard` link from Outlook on Windows with the PWA installed — opens in the PWA window, not a new browser tab.
6. Export a local ZIP backup in Edge desktop — native "Save As" dialog appears with file-name pre-filled.
7. Rotate a Galaxy Tab to landscape inside the installed PWA — orientation follows, layout intact.
8. Scroll inside Equipment table on a Pixel — no accidental page refresh from the nested scroll.

