
# Plan — Eliminate the iPad "60 pending" stuck-sync condition

The platform constraint is real (WebKit has no Background Sync), but the app currently leaves a lot of foreground time on the table and gives the user no way to force a clean drain. This plan adds five targeted, app-side fixes that together turn "60 pending sitting forever" into "drains within a minute of opening the app."

No backend / RLS changes. No new tables. All changes are client-side, behind feature-detection so non-iOS paths are untouched.

---

## 1. Foreground "Drain Mode" with Screen Wake Lock

**Problem.** Today the foreground sync interval on mobile is **60 s** (`MOBILE_SYNC_INTERVAL` in `useAutoSync.tsx:59`). On iPad in Safari, the user has to keep the tab open and the screen on for ~60 s × ceil(60/batch) just to push 60 records — and iPad auto-lock kills the tab in 30 s by default.

**Fix.**
- Add `src/lib/wake-lock.ts` — thin wrapper around `navigator.wakeLock.request('screen')` with re-acquire on `visibilitychange→visible` (Safari releases the lock on tab background, must be re-requested).
- New "DRAIN PENDING" primary action in `SyncPulse` that, while held active:
  - acquires a screen wake lock,
  - sets a `drainMode` ref that `useAutoSync` consults to use a **5 s** interval instead of 60 s,
  - calls `forceSync({force:true})` immediately and on every batch completion,
  - shows a live counter ("42 of 60 remaining…") sourced from `unsyncedCount`,
  - auto-exits when count hits 0 OR user taps STOP OR 10 minutes elapse (safety cap),
  - releases the wake lock on exit.
- Wake Lock API is supported on iOS 16.4+ Safari and all installed PWAs; on older iOS it gracefully no-ops and we fall back to a "keep this screen on" toast.

**Why this is the highest-impact change.** It removes the two biggest foreground-time killers (auto-lock + 60 s polling) for the duration of an explicit user-initiated drain, without changing the steady-state battery profile.

## 2. Adaptive foreground interval

**Problem.** The 60 s mobile interval is tuned for battery during normal browsing. When `pending > 0` and the tab is visible + online, that cadence is needlessly slow.

**Fix.** In `useAutoSync.tsx`, compute the active interval as:
- `pending === 0` → keep 60 s mobile / 30 s desktop (today's behavior)
- `pending > 0 && document.visibilityState==='visible' && navigator.onLine` → **10 s** on mobile, **5 s** on desktop
- `drainMode === true` (Section 1) → 5 s on all platforms

No new state — just a derived value. Re-uses the existing 1.5 s min-gap throttle in `updateUnsyncedCounts` so we don't thrash the IDB read path.

## 3. Promote PWA install when pending data is at risk in Safari-browser mode

**Problem.** `IOSInstallPromptOnce` only escalates copy when `isPersisted === false && unsyncedCount > 0`. The dismissed-once flag is honored too aggressively and the banner is easy to scroll past.

**Fix.**
- Lower the at-risk threshold: when running in iOS Safari (not standalone) AND `unsyncedCount >= 10`, show a **non-dismissible inline blocker above the dashboard** (still not a full-screen modal — keeps the user able to keep working) explaining that the data won't drain reliably until the app is installed. Includes the exact 3-tap install instructions.
- Below 10 pending, behavior is unchanged (dismissible banner).
- Threshold is a single constant `IOS_BROWSER_INSTALL_FORCE_THRESHOLD = 10` so it can be tuned.

## 4. Diagnostic-driven categorization of the pending number

**Problem.** "60 pending" is opaque. The user can't tell if it's drainable (just needs foreground time), stuck on validation (needs FIX taps), or quarantined (needs admin action).

**Fix.** Extend the badge in `SyncPulse` tooltip + the BackgroundSyncStatus alert title to break down:
- `N drainable` (rows + photos that the next sync cycle can push)
- `N need fixes` (`STUCK_VALIDATION` rows — link to existing FIX deep-links, leveraging `mem://features/required-field-completion-gate`)
- `N quarantined` (already surfaced in Sync Terminal — just lift the count up)

All three numbers come from existing helpers (`getUnsynced*`, `sync-quarantine.getQuarantinedIds`, `header-required-fields` validators). No new sources of truth.

This means the user learns *immediately* whether "Drain Mode" will help or whether they need to tap FIX first — the #1 source of confusion in the screenshot.

## 5. Push notification when unsynced data ages past a threshold

**Problem.** A user can close the iPad with 60 pending and not realize it for days. Push is the only channel iOS lets us use without an open tab.

**Fix.** Reuse the existing push infrastructure (`sw-push.js`, `usePushNotifications`). On `visibilitychange→hidden` with `unsyncedCount > 0`, schedule a server-side push via the existing `send-push-notification` edge function with a `notBefore` of `now + 6h`. The notification deeplinks back into the PWA, which auto-resumes sync on cold start (already wired). If the user reopens before 6 h, cancel the scheduled push.

This is opt-in (gated behind the existing push permission) and only fires when the user already granted notifications. Zero impact on non-permitted users.

---

## Files touched

```text
src/lib/wake-lock.ts                       (new — ~60 lines)
src/hooks/useAutoSync.tsx                  (adaptive interval + drainMode ref)
src/components/pwa/SyncPulse.tsx           (DRAIN PENDING button + categorized counts)
src/components/pwa/BackgroundSyncStatus.tsx (use categorized counts in title)
src/components/pwa/IOSInstallPromptOnce.tsx (non-dismissible variant >= threshold)
src/components/pwa/PWAProvider.tsx         (expose categorized counts via context)
src/hooks/usePWA.tsx                       (extend PWAContextType + fallback)
```

Plus a memory entry `mem://features/ios-foreground-drain-mode` documenting the wake-lock + adaptive-interval contract so future changes don't regress it.

## Out of scope (intentionally)

- **No service-worker background sync attempt.** WebKit doesn't support it; trying again is wasted effort.
- **No change to the sync pipeline itself** (batch sizes, retry buckets, quarantine). Those are working as designed; the issue is purely *foreground time*, not pipeline correctness.
- **No write to IndexedDB schema.** All five fixes are presentation + scheduling only.

## Verification

1. iPad Safari, 60 pending, tap DRAIN PENDING → screen stays on, counter visibly decrements, hits 0 within ~60 s on strong WiFi.
2. iPad Safari, 15 pending, no install → blocker banner appears above dashboard with install steps; cannot be dismissed but does not block scrolling.
3. Categorized count: induce a `STUCK_VALIDATION` row → badge shows `1 need fixes`, tapping reveals the FIX link.
4. Existing vitest suite (`useAutoSync`, `SyncPulse`, sync-boundary tests) stays green; add focused tests for the new interval-selection function and wake-lock wrapper.
5. Non-iOS desktop Chrome behavior unchanged (interval 30 s when `pending===0`, 5 s when `pending>0`).
