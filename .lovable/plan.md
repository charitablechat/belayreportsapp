

## Fix 3.D — Graceful `onblocked` recovery in `getDB()`

### Problem

`src/lib/offline-storage.ts:1195` currently has:
```ts
async blocked() {
  console.warn('[Offline Storage] DB upgrade blocked by another tab');
},
```

That's it — no recovery. When the DB is "blocked", another connection (typically the Service Worker, or another tab) is holding an open handle at the older version. The new `openDB(...)` promise will hang **forever** until that connection closes or the timeout (5s, per the wrapper at `openDBV8WithTimeout`) rejects. Once the timeout fires, the user is stuck in network-only mode for the session.

This was tolerable while the SW never actually opened IDB at the right version (Fix 3.A wasn't deployed). After 3.A, the SW will hold a real connection to v15, and the next bump (v16) will hit this code path on every user. Upgrade-day lockup is a real, predictable risk.

### Plan

#### 1. `blocked()` — postMessage the SW to release its handle, then let the open retry naturally

The `idb` library will resolve the `openDB()` promise as soon as the blocking connection closes. So all `blocked()` needs to do is *cause* the close. The SW is the most likely culprit (per Fix 3.A); other tabs are a secondary cause and we can't force them to close.

Replace the existing `blocked()` body with:

```ts
async blocked(currentVersion, blockedVersion) {
  console.warn(
    `[Offline Storage] DB upgrade blocked: open at v${currentVersion}, want v${blockedVersion}. ` +
    `Asking Service Worker to release its connection.`
  );
  // Ask the SW to close any IDB handles it's holding so the upgrade can proceed.
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      reg.active?.postMessage({
        type: 'CLOSE_IDB_FOR_UPGRADE',
        dbName: DB_NAME,
        targetVersion: blockedVersion,
      });
    }
  } catch (err) {
    console.warn('[Offline Storage] Could not notify SW about upgrade:', err);
  }
  // Best-effort user notification — only fires if the upgrade is actually slow.
  // Defer 1500ms so the common case (fast SW close + auto-retry) stays silent.
  setTimeout(() => {
    if (dbPromise) {
      // Still pending → surface to user via the existing notification center.
      void addSyncNotification?.({
        type: 'warning',
        title: 'Database upgrade pending',
        message: 'Close other tabs of this app to complete the upgrade.',
      }).catch(() => {});
    }
  }, 1500);
},
```

Two subtleties:

- **No explicit retry needed.** `idb`'s `openDB` resolves automatically once the blocking connection closes. Manually closing+reopening would race with that internal promise.
- **Existing 5s timeout still applies** as a hard ceiling. If the SW + other tabs all refuse to release, the user falls back to network-only — same as today, just with a clear notification of why.

The `addSyncNotification` reference: it's already imported at the top of `offline-storage.ts` (used elsewhere in the file). Will reuse that import; no new imports needed beyond confirming.

#### 2. `blocking()` — close *our* connection if a newer version wants in

The current `blocking()` is also just a `console.warn`. Mirror the symmetric fix: when *we* are the blocker (i.e. another tab loaded a newer build), proactively close our connection so their upgrade can proceed.

```ts
async blocking(currentVersion, blockedVersion, event) {
  console.warn(
    `[Offline Storage] This tab is blocking DB upgrade: holding v${currentVersion}, ` +
    `another context wants v${blockedVersion}. Closing connection.`
  );
  try {
    // Close our handle so the other context can upgrade.
    (event.target as IDBDatabase | null)?.close?.();
    // Invalidate the cached promise so the next getDB() call reopens at the new version.
    dbPromise = null;
  } catch (err) {
    console.warn('[Offline Storage] Failed to close blocking connection:', err);
  }
},
```

This is the multi-tab counterpart to Fix 3.A: the older tab self-evicts so the newer tab's upgrade lands without a 5-second timeout.

#### 3. `public/sw-sync.js` — handle `CLOSE_IDB_FOR_UPGRADE` from the main thread

Add a message listener that closes any open DB handle the SW has cached. The SW currently opens IDB ad-hoc inside each sync entry point and doesn't keep a long-lived reference, but `getDB()` calls inside Workbox sync handlers can leave a handle open until garbage collection. Easiest correct fix: set a flag that causes the next `openDB(...)` call to skip, and call `.close()` on any module-level reference if one exists.

Add near the top of `sw-sync.js`, after the `DB_CONFIG_OK` block:

```js
// When the main thread is mid-upgrade, the SW must release its IDB handle.
// Set by main thread via postMessage; cleared on next 'activate' event.
var SW_IDB_PAUSED_FOR_UPGRADE = false;

self.addEventListener('message', function(event) {
  var data = event && event.data;
  if (!data || data.type !== 'CLOSE_IDB_FOR_UPGRADE') return;
  if (data.dbName !== DB_NAME) return;
  console.log('[SW Sync] Pausing IDB access for main-thread upgrade to v' + data.targetVersion);
  SW_IDB_PAUSED_FOR_UPGRADE = true;
  // Auto-resume after 30s in case the upgrade fails / no follow-up signal arrives.
  setTimeout(function() { SW_IDB_PAUSED_FOR_UPGRADE = false; }, 30000);
});
```

Then extend the existing `dbConfigGuard()` (added in Fix 3.B) to also check this flag — or add a sibling guard `idbPauseGuard(label)` and call both in each of the four sync entry points. Cleaner is to fold the check into `dbConfigGuard()`:

```js
function dbConfigGuard(label) {
  if (!DB_CONFIG_OK) {
    console.warn('[SW Sync] Skipping ' + label + ' — db-config.js missing.');
    return false;
  }
  if (SW_IDB_PAUSED_FOR_UPGRADE) {
    console.warn('[SW Sync] Skipping ' + label + ' — IDB paused for main-thread upgrade.');
    return false;
  }
  return true;
}
```

The four sync entry points already early-return on `dbConfigGuard()` returning `false` (Fix 3.B), so no further changes there.

### Why this is enough

- **Common case (single tab, SW open):** main tab calls `getDB()` at v16 → `blocked()` fires → SW pauses + closes → `openDB` resolves within ~50ms. Silent.
- **Multi-tab, both stale:** old tab gets `blocking()` → closes → new tab's `openDB` resolves. Silent.
- **Multi-tab, one new + one old:** old tab gets `blocking()` from the new tab's open attempt → closes its handle. New tab succeeds. Silent.
- **Worst case (3+ stale tabs, SW frozen):** notification fires after 1.5s telling user to close other tabs. After 5s total, falls back to network-only mode. No corruption — IDB never opens at the wrong version because the upgrade transaction is atomic.

### Out of scope

- No SW-side resume signal after upgrade completes. The 30s auto-clear is sufficient; the upgrade transaction itself takes <1s, and any sync triggered in that window will simply requeue on the next `sync` event. Adding a `RESUME_IDB` round-trip would add complexity for negligible benefit.
- No changes to the 5s `openDBV8WithTimeout` ceiling. That's the right backstop.
- No changes to `auth-resilience.ts` / `auth-crypto.ts` / `idb-migration-safety.ts` — they're independent sibling DBs with their own (much simpler) upgrade paths and no SW handles.
- No new tests. The behavior is event-driven against real browser IDB internals; meaningful coverage would require a full Playwright multi-tab harness, which is out of scope for this gap.

### Files touched

1. **`src/lib/offline-storage.ts`** — replace `blocked()` and `blocking()` callback bodies in `getDB()` (lines 1195-1200).
2. **`public/sw-sync.js`** — add `SW_IDB_PAUSED_FOR_UPGRADE` flag, `message` listener for `CLOSE_IDB_FOR_UPGRADE`, extend `dbConfigGuard()` to honor the pause flag.

