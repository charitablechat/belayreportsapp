

# Versioning System Audit — Findings & Fix Plan

## TL;DR

The displayed version number works, but **the cross-platform update mechanism is broken**. Devices never receive new versions through the PWA update flow — they only update via hard browser reload or by clearing cache. This is why versions feel inconsistent across devices.

---

## Findings (root causes, ranked by severity)

### 🔴 CRITICAL #1 — `public/sw.js` is a self-destroying service worker

`public/sw.js` (15 lines) **unregisters itself on activate** and clears all caches:

```js
self.registration.unregister(),
caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
```

But `vite-pwa-config.ts` configures VitePWA to generate a **real workbox SW at the same path** (`/sw.js`). The static `public/sw.js` **overrides the generated one** in the build output (Vite copies `public/` last). Result:

- No workbox precache, no runtime caching, no `importScripts(['/sw-push.js', '/sw-sync.js'])` — push and background sync workers never load.
- `usePWAUpdate` listens for `updatefound` / `waiting` SW — **never fires** because the SW unregisters itself within seconds of every load.
- Users only get new app versions by hard-reloading the browser. iOS/Android/Windows behave identically wrong here.
- Combined with `registerType: 'prompt'` + `injectRegister: null`, no SW is ever registered by VitePWA either way.

**This is the root cause** of "different devices show different versions."

### 🔴 CRITICAL #2 — Push & background-sync workers are dead

`vite-pwa-config.ts` does `importScripts: ['/sw-push.js', '/sw-sync.js']` inside the workbox SW. Since the workbox SW is replaced by the self-destroyer, these never execute. Background sync (recently confirmed working) is **only running via the in-app `useBackgroundSync` hook** (page-context Background Sync API), not the SW. Push notifications can't fire when app is closed.

### 🟠 HIGH #3 — Version incrementer logic contradicts itself

`vite-auto-version.ts` writes `version.json` and a `.version-timestamp` marker, but both are **committed to git**. Each Lovable Cloud build:
1. Reads `version.json` (e.g. `4.7.2`)
2. Checks `.version-timestamp` — if mtime within 5s, **skip increment**
3. Writes new value (ephemeral, doesn't persist)

The header comment says "each build displays committed value + 1." Screenshot shows `v4.7.2` (the committed value, **not** +1). So either the debounce always wins, or the increment isn't being applied to the `define` map. Either way: **version number does not advance automatically across deploys** — you have to hand-bump `version.json` and commit. Users on different devices see the same number only because nobody is incrementing.

### 🟠 HIGH #4 — `APP_VERSION` source resolution is inconsistent

- `src/lib/attestation.ts` reads `VITE_APP_VERSION || APP_VERSION || 'unknown'` — but `VITE_APP_VERSION` is **never defined anywhere**. Dead branch.
- `VersionInfoModal`, `UpdateControlPanel`, `useAutoSync` read only `APP_VERSION`.
- Result: if the vite plugin ever fails silently, attestation logs `"unknown"` while the UI still shows a stale cached value. Hard to debug.

### 🟡 MEDIUM #5 — `index.html` registers `/sw.js` from preview cleanup

Lines 54–57 of `index.html` explicitly register `/sw.js` even in the preview environment when stale SWs are detected, then reload. This works as intended for cleanup, but combined with the self-destroyer, can cause **infinite register → unregister → reload loops** in edge cases on iOS Safari (which already has finicky SW lifecycle).

### 🟡 MEDIUM #6 — No version-skew protection on field-level merge

Recent `field_timestamps` work has good fallback behavior in `field-merge.ts`, BUT: an old client (cached for weeks because SW updates never propagate — see #1) writing without `field_timestamps` against a server row WITH them will lose its edit on the affected field if the row-level `updated_at` is older. Compounds with #1: until update delivery is fixed, version-skew bugs from this collaboration system are far more likely than they should be.

### 🟢 LOW #7 — Version display is purely presentational

`VersionInfoModal` and `UpdateControlPanel` show `import.meta.env.APP_VERSION`. There is **no server-side version check** — no way to know the deployed version vs. the running version. A user on a stale cached client would see the stale version with no warning.

---

## Cross-platform impact

| Platform | Current behavior | Why |
|----|----|----|
| iOS Safari (PWA) | Version frozen until user manually clears Safari cache | No working SW = no update flow. iOS 24h SW cache makes it worse. |
| Android Chrome | Version updates only on full browser restart | Same — no SW lifecycle, no `updatefound` event. |
| Windows desktop | Updates on hard reload (Ctrl+Shift+R) | Browser HTTP cache eventually expires; faster than mobile. |
| Lovable preview | Always fresh | Preview cleanup script kills SW on every load. |

The "Update Available" badge (`UpdateBadge.tsx`) literally cannot appear in production because `needsUpdate` requires a waiting SW that never exists.

---

## Proposed fixes (in order)

### Fix 1 — Restore real PWA service worker (CRITICAL)

- **Delete** `public/sw.js` (or rename to `sw-cleanup.js` and only register it conditionally during one-time migration).
- Change `vite-pwa-config.ts`: `registerType: 'autoUpdate'` (industry default) and `injectRegister: 'auto'` so VitePWA generates AND registers the SW.
- Remove the manual `navigator.serviceWorker.register('/sw.js', ...)` from `src/main.tsx` (lines 39–47) — let VitePWA handle it via virtual module `virtual:pwa-register`.
- Update `usePWAUpdate` to use VitePWA's `useRegisterSW` hook (or keep current code, it already handles waiting SW correctly).
- Keep `index.html` cleanup script for **preview only**, gated strictly on hostname.
- One-time migration concern: existing users have the self-destroying SW. After deploy, their next page load runs the self-destroyer, the workbox SW takes over on the load after that. Two-load transition is acceptable.

### Fix 2 — Fix version increment

Two options, recommend **A**:

- **A. Use commit count as patch** — read git commit hash/count at build time, format `v{major}.{minor}.{commitCount % 10}`. Always advances, no `version.json` write-back required. ~10 LOC.
- **B. Move version source to env var** set per-deploy by Lovable Cloud (if available via `VITE_BUILD_ID` or similar). Requires checking what Lovable injects.

Either way: **delete `.version-timestamp` from the repo** and add to `.gitignore`. The current debounce relies on filesystem state that doesn't exist consistently in CI.

### Fix 3 — Single source of truth for `APP_VERSION`

- In `src/lib/attestation.ts` line 11–13, drop the `VITE_APP_VERSION` branch. Read only `import.meta.env.APP_VERSION`.
- Add a runtime warning if `APP_VERSION === 'unknown'` so we catch plugin failures fast.

### Fix 4 — Server-side version awareness (defense in depth)

- Store the latest deployed version in a tiny public table or edge function (`current-app-version`).
- On app load, compare local `APP_VERSION` vs server. If server is newer AND no SW update has fired within 60s, show a soft "New version available — refresh to update" banner.
- Catches the case where SW updates fail silently (iOS + corp proxies + flaky CDN edges).

### Fix 5 — Add version field to attestation audit log query

Verify `app_version_at_completion` is being persisted (it's in the SQL — confirmed). Add it to the audit log viewer (`AuditLogPanel`) so admins can see which version each completion was signed under. Already partly there — verify.

---

## Files to change

**Delete / rename:**
- `public/sw.js` → delete (or move to `public/sw-legacy-cleanup.js` for one transition deploy)
- `.version-timestamp` → delete and gitignore

**Edit:**
- `vite-pwa-config.ts` — `registerType: 'autoUpdate'`, `injectRegister: 'auto'`
- `vite-auto-version.ts` — switch to commit-count strategy, no file write
- `src/main.tsx` — remove manual SW registration block (lines 39–72 cleanup)
- `src/lib/attestation.ts` — single env var read + warning
- `index.html` — confirm preview cleanup script is preview-only (already is)
- `src/hooks/usePWAUpdate.tsx` — minor: ensure works with autoUpdate mode

**New:**
- `src/lib/version-check.ts` — server version comparison utility
- `supabase/functions/current-app-version/index.ts` — returns deployed version (optional, fix #4)

**No DB migration required.** No data loss risk; only behavior change is users will start receiving real updates instead of being stuck.

---

## Question before I build

Two design choices:

**Q1 — SW rollout strategy:**
- **Safe (recommended)**: keep a tiny one-time cleanup SW for one deploy to unregister the old self-destroyer cleanly, then second deploy enables the real workbox SW. Two deploys, zero user disruption.
- **Fast**: delete `public/sw.js` immediately; rely on the existing self-destroyer to unregister itself one final time, then VitePWA's SW takes over on the next page load. One deploy, some users may see one extra reload.

**Q2 — Server version banner (Fix #4):**
- **Yes** — add the soft refresh banner. Catches edge cases.
- **No** — trust the SW flow only. Less code.

Reply `safe + yes`, `fast + yes`, `safe + no`, or `fast + no` and I'll execute. (My recommendation: **safe + yes**.)

