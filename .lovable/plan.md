

## Apple/iOS/iPad — second-pass gap audit

The first iOS pass closed icons, splash, HEIC timeouts, persistence prompts, file pickers, and the empty-cleanup auth race. This audit looks at what's left across **API completeness, feature parity, cross-device handoff, and OS-version readiness** — and proposes only the gaps worth closing.

---

### Real gaps (worth fixing)

**A1 — `theme-color` doesn't follow dark mode**

`index.html` declares one static `theme-color="#1e40af"`. iOS 15+ uses this for the status-bar tint in installed PWAs. With our dark-mode aesthetic that means a bright blue bar over a near-black UI on dark devices.

**Fix:** two `<meta name="theme-color">` tags with `media="(prefers-color-scheme: …)"` — light value stays current blue, dark value matches the app's dark surface.

---

**A2 — iOS PWA status-bar style is default (white)**

No `apple-mobile-web-app-status-bar-style` meta tag. iOS shows a white opaque status bar that doesn't blend with the dark app shell.

**Fix:** add `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">` so the app draws under the status bar (we already use `viewport-fit=cover` and safe-area insets, so layout is ready for it).

---

**A3 — File `<input>` is missing `capture` hints on report photo uploads**

iOS Safari respects `capture="environment"` to open the rear camera directly instead of the chooser sheet. Inspectors taking on-site photos currently get the chooser every time. The dedicated `PhotoCapture` flow already opens the camera, but `ItemPhotoUpload`'s "Upload" button (used for adding additional photos to a row) goes through the generic chooser.

**Fix:** add `capture="environment"` to the inspection photo `<input>` only when triggered from the "Take Photo" path. Leave the generic "Choose from library" path unchanged. (iOS ignores `capture` on desktop, no cross-platform regression.)

---

**A4 — Pull-to-refresh fights iOS rubber-banding inside scrollable form sections**

`usePullToRefresh` is wired at the page level. On iPad, when a user scrolls inside `EquipmentTable` or `OperatingSystemsTable` (scroll containers nested inside the page), the pull gesture sometimes triggers a refresh while they're trying to scroll up within the table. iOS-only — Android `overscroll-behavior` already isolates them.

**Fix:** add `overscroll-behavior: contain` to the `.overflow-auto` table containers. Pure CSS, no JS change.

---

**A5 — Web Share Target is not declared in the manifest**

`saveToDevice` already handles outgoing Web Share on iOS, but the manifest has no `share_target` entry. That means users can't share *into* the app from Photos (e.g. "share this image to Rope Works → attach to inspection"). On iOS 16.4+ installed PWAs this is supported.

**Decision needed:** this is a real feature, not a fix. Skip unless you want it (would need a `/share-receive` route + handler). Listing it for completeness.

---

**A6 — `viewport` meta is missing `interactive-widget=resizes-content`**

When the iOS keyboard opens over a long form (e.g. Training observations), the visual viewport shrinks but layout viewport doesn't, so sticky bottom buttons get hidden behind the keyboard. We have `useKeyboardAvoidance` to scroll the focused field into view, but the bottom action bar still floats off-screen.

**Fix:** add `interactive-widget=resizes-content` to the viewport meta. iOS 17+ honors it; older iOS ignores it (no regression). Eliminates a class of "where did the Save button go?" reports.

---

**A7 — `apple-mobile-web-app-title` missing**

When users Add to Home Screen, iOS uses the `<title>` (currently "Rope Works Inspection") which can get truncated under the icon. Setting an explicit short title fixes this.

**Fix:** add `<meta name="apple-mobile-web-app-title" content="Rope Works">`.

---

**A8 — Safari date inputs render natively but our placeholder logic assumes empty-string**

`PreviousInspectionDatePicker` and date fields elsewhere read `e.target.value`. iOS Safari's native `<input type="date">` returns `""` until a full valid date is selected, but on iPad in landscape it sometimes briefly returns a partial value during the wheel scroll. Our autosave fires on every change → can write a malformed date to IDB.

**Fix:** validate `value.match(/^\d{4}-\d{2}-\d{2}$/)` before persisting. One-line guard in the change handler.

---

### Already solid (don't touch)

- Apple-touch-icons at 152/167/180 + startup-image (just shipped)
- Session-presence guard before child-count cleanup query (just shipped)
- HEIC 25 s timeout + retry on iOS (just shipped)
- IOSInstallPromptOnce data-loss re-prompt (just shipped)
- File pickers accept `.heic`/`.heif` explicitly (just shipped)
- Safe-area insets via `SafeAreaWrapper` and `viewport-fit=cover`
- Web Share API used for `saveToDevice` outgoing flow on iOS PWA
- Background-sync polling fallback (iOS lacks `SyncManager`)
- Push notifications behind the iOS 16.4+ PWA-only requirement check
- Server-side `BEFORE DELETE` triggers protect iOS users on stale builds

---

### Out of scope (real work, separate decision)

- **Capacitor / App Store native shell** — only path to: Apple Sign-In, native HEIF decoding, true background sync, Live Activities, Handoff, AirDrop receive, Universal Clipboard, native push without PWA install. Requires App Store account and a separate release pipeline.
- **Web Share Target** (A5) — useful if inspectors want to share photos *into* the app from Photos. Skipping unless requested.
- **Apple Sign-In OAuth** — no demand surfaced; requires Apple Developer account.
- **iOS shortcut/Siri integration** — Capacitor-only.

---

### Files to change

- `index.html` — A1 (dark `theme-color`), A2 (status-bar style), A6 (`interactive-widget`), A7 (`apple-mobile-web-app-title`)
- `src/components/inspection/ItemPhotoUpload.tsx` — A3 (`capture="environment"` on the camera button's input only)
- `src/index.css` — A4 (`overscroll-behavior: contain` on `.overflow-auto, table` containers, scoped to iOS via `@supports (-webkit-touch-callout: none)`)
- `src/components/PreviousInspectionDatePicker.tsx` — A8 (date format guard before persisting)

No DB migrations. No edge functions. No new dependencies. ~25 LOC total.

### Risk

- A2 (`black-translucent`): app already uses `viewport-fit=cover` + safe-area insets, so no layout regression expected. Worst case: status-bar text becomes hard to read briefly on a single light-themed screen — visible immediately, easy revert.
- A6 (`interactive-widget=resizes-content`): silently ignored on iOS <17, no downside.
- A4 (`overscroll-behavior: contain`): could in rare cases prevent a user reaching the page-level pull-to-refresh while scrolled inside a table. Mitigated by scoping to `.overflow-auto` only — page itself still pulls.
- A8: tighter validation could in theory drop a valid edge-case format; mitigated by accepting the canonical ISO format the native picker always emits.

### Verification

1. Install PWA on a dark-mode iPhone — status bar matches app, not bright blue.
2. Tap "Take Photo" on an Equipment row in Safari iOS — rear camera opens directly, no chooser.
3. Scroll inside the Equipment table on iPad — no accidental page refresh.
4. Open Training observations on iOS 17, tap into long textarea — Save button stays visible above the keyboard.
5. Add to Home Screen on iPhone — icon label reads "Rope Works", not truncated.

