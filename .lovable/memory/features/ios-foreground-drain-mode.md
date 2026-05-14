---
name: iOS Foreground Drain Mode
description: Wake-lock + 5s sync interval + non-dismissible install gate combat WebKit's lack of Background Sync on iPad/iPhone Safari
type: feature
---
**Problem.** WebKit has no Background Sync API. A backgrounded Safari tab on iPad has its JS suspended within seconds; iPad auto-lock kills the tab in 30s. With the normal 60s mobile sync cadence, a queue of 10–60 pending records never drains in casual use.

**Three coordinated fixes** — all client-side, no schema or pipeline changes:

1. **`src/lib/wake-lock.ts`** — wraps `navigator.wakeLock.request('screen')`. Re-acquires on `visibilitychange→visible` while user-facing intent is still set (Safari releases on hide). Graceful no-op on iOS < 16.4.

2. **`src/lib/drain-mode.ts`** — module-level singleton (NOT React state — `useAutoSync` reads it inside its periodic interval; React context would force interval re-mount on every change). `startDrainMode()` acquires wake lock, kicks runner immediately, schedules 10-min safety stop. `stopDrainMode()` releases. `subscribeDrainMode(fn)` for UI. `useAutoSync` registers `performSync` as runner via `registerDrainRunner`.

3. **Adaptive interval in `useAutoSync.scheduleNextSync` / `computeInterval`**:
   - Drain Mode active → `DRAIN_SYNC_INTERVAL_MS` (5s)
   - pending>0 + visible + online → `MOBILE_PENDING_VISIBLE_INTERVAL` (10s) / `DESKTOP_PENDING_VISIBLE_INTERVAL` (5s)
   - pending>0 → `activeSyncInterval` (60s mobile / 30s desktop)
   - idle → `idleSyncInterval`

   Subscribed to drain-mode toggles AND to `sync-records-updated` / `sync-photos-updated` so cadence flips immediately on user action or queue change.

4. **`SyncPulse.tsx` Drain panel** — appears when `totalUnsynced > 0 && isOnline`. Shows count remaining, DRAIN NOW / STOP button. Auto-stops via `useEffect([drainActive, unsyncedCount, unsyncedPhotoCount])` when both hit zero. Surfaces a "Disable Auto-Lock" hint when wake-lock unsupported.

5. **`IOSInstallPromptOnce.tsx` force-install gate** — `IOS_BROWSER_INSTALL_FORCE_THRESHOLD = 10`. When iOS Safari (browser-mode, not standalone) AND `unsyncedRecords + unsyncedPhotos >= 10`, banner becomes non-dismissible (no X button, red severity, copy explains Safari suspension). Below threshold: existing dismissible behavior unchanged.

**Why a module-level singleton for drain mode (not context):**
`useAutoSync`'s `setInterval` callback closes over interval-selection logic. Reading from a React context would require re-creating the interval on every state change, which fights the existing 1.5s coalescer + 5s freshness throttle in `updateUnsyncedCounts` (`mem://architecture/unsynced-counts-coalescer`). The singleton lets the interval body call `isDrainModeActive()` / `unsyncedCountRef.current` without re-mount.

**Battery contract.** Adaptive boost (10s/5s) only fires when `pending>0 && document.visible && navigator.onLine` — i.e. user is actively staring at the app. Steady-state idle cadence (180s mobile / 120s desktop) is unchanged.
