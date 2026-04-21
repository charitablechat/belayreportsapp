

## Apple/iOS/iPad gap audit — what's left

After the data-integrity work, here's what I found auditing every iOS-specific code path. **Three real gaps, two cosmetic, one nice-to-have.** Most are small; one matters for sync reliability.

---

### Gap 1 — Manifest is missing iOS-specific touch icon sizes (cosmetic, real)

`public/manifest.json` only declares one icon image at 192/512. iOS Safari/Home Screen ignores the manifest's `icons` array for the home-screen icon and instead reads `<link rel="apple-touch-icon">`. We have **one** apple-touch-icon (`/icons/app-icon.png`, no size attribute), so iOS scales the same image for every device. This works but produces fuzzy icons on iPad Pro (167×167) and old iPhones (152×152).

**Fix:** add three `<link rel="apple-touch-icon" sizes="…">` entries in `index.html` for 152, 167, and 180. Reuse the existing `/icons/app-icon.png` (iOS scales fine, just wants the explicit size hint to pick the closest match).

---

### Gap 2 — No iOS splash screens (`apple-touch-startup-image`)

When a PWA launches from the iOS Home Screen, iOS shows a white flash (or black depending on theme) until the JS bundle parses. We never declared `apple-touch-startup-image` link tags, so users see a blank screen for ~1–2 s on cold launch. Not data-loss, but it makes the installed app feel broken on first tap.

**Fix:** generate startup images for the common iPad/iPhone sizes (or one universal one) and add the `<link rel="apple-touch-startup-image" media="…">` tags. Lowest-effort version: a single splash with the Rope Works logo on `#ffffff` background, declared without media queries (iOS will use it as fallback).

---

### Gap 3 — `useEmptyReportCleanup` server-side child-count check uses anon RLS path on iOS PWA in background

When iOS suspends a PWA (tab hidden >30s, low-memory eviction), the next foreground wake fires `pageshow` → `useAutoSync` → may call cleanup paths before `supabase.auth` rehydrates the session from storage. The server-side child-count guard we just shipped will return `count: 0` for any RLS-protected child table when the request goes out without a JWT, which would then **falsely confirm "report is empty"** and proceed with the soft-delete.

**Fix:** before the count query, await `supabase.auth.getSession()` and abort if no session. Cheap one-line guard. Same pattern used elsewhere in `useAutoSync`'s `handlePageShow`.

---

### Gap 4 — `convertHeicBlobToJpeg` 10s timeout is tight for iPad Air (gen 1–3) on multi-MB photos

iPads from 2018–2020 routinely take 8–14s to decode a 4032×3024 HEIC via `heic2any` (which is pure JS, no native HEIF). When it times out, the photo silently falls through with the original HEIC bytes still labeled `.jpg`, breaking PDF generation.

**Fix:** raise the per-conversion timeout to 25s for iOS specifically (keep 10s elsewhere), and add a single-retry on timeout. Total worst-case 50s, only on iPad with HEIC photos, only at upload time. Acceptable.

---

### Gap 5 — `requestPersistentStorage()` is called but result is never surfaced to user when denied

iOS only grants persistent storage to installed PWAs (Add to Home Screen). For users in Safari, the request silently returns `false` and nothing tells them their data could be evicted in 7 days of inactivity. We have `IOSInstallPromptOnce` but it shows on every iOS Safari load — not tied to actual storage-persistence denial, and gets dismissed permanently after one tap.

**Fix:** when `requestPersistentStorage()` returns `false` AND the user has unsynced offline data AND they're on iOS Safari (not PWA), upgrade `IOSInstallPromptOnce` to re-show with stronger wording: *"You have N unsaved reports. iOS may delete them in 7 days unless you Add to Home Screen."* Auto-resets the dismissed flag any time `unsyncedCount > 0`.

---

### Gap 6 — `accept="image/*"` on `ItemPhotoUpload` doesn't include `.heic` explicitly

iOS Safari's file picker correctly handles `image/*` for camera roll, but the Files-app picker (used when picking from iCloud) sometimes filters out `.heic` files unless they're explicitly listed. Inconsistent — works for some users, hides photos for others.

**Fix:** change `accept="image/*"` → `accept="image/*,image/heic,image/heif,.heic,.heif"` in `ItemPhotoUpload.tsx`, `ContactDeveloper.tsx`, and `AdminLogoManagement.tsx`. One-line edit each.

---

### What's already solid (don't touch)

- `pageshow` / `visibilitychange` handlers are wired in `useAutoSync`, `usePWAUpdate`, `Dashboard`, `useScrollRestoration` — all the right places
- `saveToDevice` already routes through Web Share on iOS PWA (download fallback wouldn't work there)
- HEIC magic-byte detection catches mislabeled `.jpg` files
- Safe-area CSS variables are wired in `index.css` and exposed via `SafeAreaWrapper`
- `viewport-fit=cover` is set in `index.html`
- Background-sync `SyncManager` is correctly disabled on iOS (no API support); polling fallback via localStorage flags is in place
- The new server-side BEFORE DELETE triggers protect iOS users on stale PWA versions

---

### Files to change

- `index.html` — add 3 `<link rel="apple-touch-icon" sizes>` tags + startup-image tag (Gaps 1, 2)
- `src/hooks/useEmptyReportCleanup.tsx` — session-presence guard before child-count query (Gap 3)
- `src/lib/heic-converter.ts` — iOS-aware timeout + single retry (Gap 4)
- `src/components/pwa/IOSInstallPromptOnce.tsx` — re-prompt logic when unsynced data + storage not persisted (Gap 5)
- `src/components/inspection/ItemPhotoUpload.tsx`, `src/components/ContactDeveloper.tsx`, `src/pages/AdminLogoManagement.tsx` — explicit `.heic` in accept (Gap 6)
- (Optional) `public/icons/splash.png` — new asset for startup image

No DB migrations. No edge function changes. No new dependencies.

### Risk

- Gap 3 fix could over-block in edge cases where session is mid-refresh; mitigated by single 2s retry before aborting.
- Gap 5 re-prompt could annoy iOS Safari users who legitimately don't want to install. Mitigated by gating on `unsyncedCount > 0` (only shows when they actually have data at risk).
- All other changes are additive / cosmetic.

### Out of scope

- Capacitor / native iOS shell (separate decision, would require App Store account).
- Replacing `heic2any` with native iOS HEIF decoding (only available in Capacitor).
- Apple Sign-In OAuth (no user demand surfaced yet).

