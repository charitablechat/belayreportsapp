## Scope

Replace legacy "Rope Works" branding with Belay Reports in the PWA manifest, head metadata, and all PWA icon files. Use the uploaded square icon as the source of truth for icon generation.

## Files changed

1. **`vite-pwa-config.ts`** — manifest fields:
   - `name`: `"Rope Works Inspection"` → `"Belay Reports"`
   - `short_name`: `"RW Inspect"` → `"Belay Reports"` (12 chars, fits iOS/Android home-screen labels)
   - `description`: unchanged (already generic, no legacy brand)
   - `theme_color`: keep `#1e40af` (no new brand color was specified — call out and ask later if needed)
   - `includeAssets`: drop `rope-works-logo.avif` (file doesn't exist in `public/`, currently a dead reference)
   - `icons` array: paths unchanged (`icons/icon-192.png` etc.) — the underlying PNGs are regenerated in step 3

2. **`index.html`** — three legacy strings:
   - `<meta name="author" content="Rope Works Inc." />` → `"Belay Reports"`
   - `<meta name="apple-mobile-web-app-title" content="Rope Works" />` → `"Belay Reports"`
   - `<link rel="preload" as="image" href="/rope-works-logo.avif" ...>` → delete this line (the file isn't shipped)
   - `<title>` already says "Belay Reports — Digital Inspection Platform" — unchanged
   - `<meta name="description">` — unchanged (no brand reference)

3. **Icon PNG regeneration** — generate from uploaded `Belay_Reports_Icon_Logo_120_x_120_px.png` using Pillow (Lanczos resample for upscales, sharpening pass after upscale to mitigate 120→512 quality loss):

   | File in `public/icons/` | Size | Purpose |
   |---|---|---|
   | `favicon-16.png` | 16×16 | browser tab |
   | `favicon-32.png` | 32×32 | browser tab |
   | `apple-touch-icon.png` | 180×180 | iOS home screen |
   | `app-icon.png` | 512×512 | generic app icon |
   | `icon-192.png` | 192×192 | PWA standard |
   | `icon-512.png` | 512×512 | PWA standard |
   | `icon-192-maskable.png` | 192×192 | PWA maskable — logo centered in 80% safe area on `#0b0f17` background to match the `background_color` |
   | `icon-512-maskable.png` | 512×512 | same |
   | `favicon.png` (`public/`) | 512×512 | root favicon referenced by `index.html` |

   Also overwrite `public/favicon.ico` with a multi-resolution ICO (16, 32, 48) generated from the same source so browsers requesting `/favicon.ico` get the new mark.

   Source caveat: the uploaded icon is only 120×120. Upscaling to 512 loses sharpness. If you have a higher-res version (≥512×512 square PNG, transparent or solid background), share it and I'll re-run the icon generation — the rest of the plan stays the same.

## Files explicitly NOT changed

- **`public/db-config.js`** — `name: 'rope-works-inspections'` is the **IndexedDB database name**. Renaming it would orphan every installed PWA's offline reports, photos, and pending sync queue. Leave as-is.
- **Test files** that reference `'rope-works-inspections'` (the IDB name) — unchanged for the same reason.
- **`.lovable/memory/auth/offline-access-and-guest-mode.md`** and **`COMPREHENSIVE_TEST_PLAN.md`** — historical docs; not user-facing. Skip.
- **`tests/e2e/smoke/offline-cold-start.spec.ts`** — uses the IDB name in fixture setup. Skip.
- **`src/integrations/supabase/client.ts`**, project ref, custom domain config — not branding files.
- **Service workers** (`sw-push.js`, `sw-sync.js`, `sw-offline-navigation.js`, `offline.html`) — no legacy brand text spotted; will grep again before declaring done. If any hit appears it will be the same small string swap.

## Verification

1. `grep -rIn 'Rope Works\|rope-works\|RW Inspect' .` (excluding `node_modules`, `.lovable/memory`, `COMPREHENSIVE_TEST_PLAN.md`, test fixtures referencing the IDB name) returns nothing.
2. Re-inspect each generated icon by reading the file dimensions back (Pillow `Image.open(...).size`) and visually viewing the 192 and 512 maskable variants to confirm safe-area centering.
3. Reload preview, confirm browser tab favicon updated and `/manifest.webmanifest` returns the new `name`/`short_name` (curl from console or DevTools).
4. Note to user: a browser that already installed the PWA caches `start_url`, `id`, and `scope` from the old manifest. Manifest name/icon updates appear after the next browser-driven manifest refresh; users who already installed the app will need to either wait for the OS to re-fetch or reinstall to see the new icon on the home screen. The new icon appears immediately in browsers that have not installed yet.

## Risks

- 120×120 source upscaled to 512 will look soft on retina home screens. Mitigated by Lanczos + a mild unsharp mask, but a true ≥512 source would be better. Flagged above.
- The `theme_color` (`#1e40af` blue) doesn't match the teal+slate of the new logo. Not changing it without explicit guidance — happy to update if you give me the hex (or say "match the logo teal" and I'll sample it).

Ready to execute on approval.