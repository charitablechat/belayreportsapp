

## Fix 3.A + 3.B — Hard-fail the SW when `db-config.js` isn't loaded

### Problem

`public/sw-sync.js` defines:
```js
var DB_NAME = (typeof DB_CONFIG !== 'undefined' && DB_CONFIG.name) || 'rope-works-inspections';
var DB_VERSION = (typeof DB_CONFIG !== 'undefined' && DB_CONFIG.version) || 9;
```

Two failure modes hide here:

1. **`db-config.js` is never imported into the SW.** `vite-pwa-config.ts` lists `importScripts: ['/sw-push.js', '/sw-sync.js']` but not `/db-config.js`. When the SW runs, `DB_CONFIG` is undefined and the fallback silently picks **version 9** — but the live schema is **version 15** (`public/db-config.js`). Opening IDB at v9 against a v15 store throws `VersionError` on every sync; worse, in some browsers it can trigger a downgrade attempt and corrupt state.
2. **Even if 3.A is fixed, the silent `|| 9` fallback masks future regressions** (e.g. if `db-config.js` is renamed, evicted from cache, or 404s). The SW should refuse to open IDB at a guessed version rather than diverge from the main thread.

### Plan

#### 1. `vite-pwa-config.ts` — load `db-config.js` into the SW

- Add `'/db-config.js'` as the **first** entry in `workbox.importScripts` so it executes before `sw-sync.js` reads `DB_CONFIG`.
- Add `'db-config.js'` to `includeAssets` so the file is copied into `dist/` on build (the file already exists at `public/db-config.js`, so Vite already copies it — this is belt-and-suspenders to make the dependency explicit).
- Verify it isn't filtered out by `globIgnores` — current ignore list is only `['**/version.json']`, so `db-config.js` is fine. No change needed there.

Result: the production SW boots with `DB_CONFIG = { name: 'rope-works-inspections', version: 15 }` exactly matching the main thread.

#### 2. `public/sw-sync.js` — remove the silent fallback, hard-no-op when missing

Replace lines 3-5 with:

```js
// db-config.js must be loaded via importScripts BEFORE this script.
// If it isn't, refuse to open IndexedDB rather than guess a version.
var DB_CONFIG_OK = (typeof DB_CONFIG !== 'undefined' && DB_CONFIG && DB_CONFIG.name && typeof DB_CONFIG.version === 'number');
var DB_NAME = DB_CONFIG_OK ? DB_CONFIG.name : null;
var DB_VERSION = DB_CONFIG_OK ? DB_CONFIG.version : null;

if (!DB_CONFIG_OK) {
  console.error('[SW Sync] FATAL: db-config.js not loaded — sync handlers will no-op until next SW activation.');
}
```

Add a single guard helper and call it at the top of each of the four sync entry points (`syncInspectionsAtomic`, `syncPhotos`, `syncTrainingsAtomic`, `syncDailyAssessmentsAtomic`):

```js
function dbConfigGuard(label) {
  if (!DB_CONFIG_OK) {
    console.warn('[SW Sync] Skipping ' + label + ' — db-config.js missing, refusing to open IDB at guessed version.');
    return false;
  }
  return true;
}
```

Each entry point gets:
```js
if (!dbConfigGuard('inspection sync')) return;
```
inserted right after the existing main-thread-active deferral check, before the `try { const db = await openDB(...) }` block. Same pattern for the other three entry points (with their own labels).

The `sync` and `periodicsync` event listeners themselves don't need touching — they call into these entry-point functions, which now early-return safely.

#### 3. Notify clients on the failure mode

Inside the FATAL `console.error` branch, also fire-and-forget a `postMessage` to all clients so the main thread can surface it:

```js
self.clients && self.clients.matchAll && self.clients.matchAll().then(function(clients) {
  clients.forEach(function(c) { c.postMessage({ type: 'SW_DB_CONFIG_MISSING' }); });
}).catch(function(){});
```

No new main-thread handler is added in this gap — adding the message is cheap and lets a follow-up surface it in `SyncDiagnosticsSheet` without another SW redeploy. Forward-only plumbing.

### Out of scope

- No changes to `sw-push.js` — it doesn't reference `DB_CONFIG`.
- No changes to the openDB helper itself — the guards live in the four entry points where the failure mode actually matters.
- No changes to `db-config.js` content (already at the correct `version: 15`).
- No new main-thread UI for the `SW_DB_CONFIG_MISSING` message — postMessage is wired but no listener consumes it yet. Follow-up if desired.
- No SW version/cache-bust logic — VitePWA `autoUpdate` already activates the new SW on next page load.

### Files touched

1. **`vite-pwa-config.ts`** — add `'/db-config.js'` to `workbox.importScripts` (first), add `'db-config.js'` to `includeAssets`.
2. **`public/sw-sync.js`** — replace lines 3-5 with strict config validation; add `dbConfigGuard()` helper; add early-return guards in the four sync entry points; emit `SW_DB_CONFIG_MISSING` postMessage on FATAL.

