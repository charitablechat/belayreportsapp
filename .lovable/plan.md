

## Why the screenshot shows "2 pending" and "Poor" — and how to fix it

### What the user is actually seeing

Two separate badges in the dashboard header:

1. **Orange "2 pending" cloud chip** (`Dashboard.tsx` lines 1351–1356) — driven by `unsyncedCount` from `usePWA()`. Two records (inspection / training / assessment / photos) genuinely have not synced to the cloud yet.
2. **Dark "Poor" signal-bars badge** (`NetworkQualityIndicator.tsx`) — driven by `effectiveType` / `downlink` / `rtt` from the Network Information API.

The screenshot shows wifi at 100% battery, full bars at the OS level. So the network is fine. The "Poor" label is wrong.

### Root cause of the false "Poor" label

`NetworkQualityIndicator.tsx` is the bug. The `getNetworkQuality()` cascade is:

```ts
if (effectiveType === '4g' || (downlink && downlink > 5))   return 'excellent';
if (effectiveType === '3g' || (downlink && downlink > 1.5)) return 'good';
if (effectiveType === '2g' || (downlink && downlink > 0.5)) return 'fair';
if (rtt !== null) { /* rtt-based bucketing */ }
return 'poor';   // ← final fallback
```

The Network Information API (`navigator.connection`) **does not exist in Safari** (iOS or macOS), and is unreliable in several other browsers. When unavailable, `useNetworkStatus.tsx` correctly sets `effectiveType`, `downlink`, and `rtt` to `null`. Every branch in `getNetworkQuality()` then evaluates falsy, the rtt block is skipped, and the function returns the `'poor'` fallback.

Result: **every Safari/iOS user sees "Poor"** even on gigabit fiber. That's exactly what's in the screenshot — it's an iPad on Safari (the share/+/tabs icons in the top right and the "100%" battery glyph confirm it).

The "2 pending" chip is **not** a bug — it's accurate. Two items are queued. But because it appears next to a falsely-alarming "Poor" badge, the combined UI reads as "your connection is broken AND your data is stuck," which is what's freaking users out.

### Secondary problem

There's no fast way for a user looking at "2 pending" on iPad Safari to understand "this will sync as soon as the app gets a chance — your network is fine." The orange chip has no tooltip and no action; users assume something is wrong.

---

### Fix plan

**F1 — Stop the false "Poor" badge (the actual bug)**

In `NetworkQualityIndicator.tsx`, change `getNetworkQuality()` so that **when the Network Information API is unavailable, we return `'good'` (a neutral "we don't know, but the browser says you're online") instead of `'poor'`**.

Concretely:
- Detect "no API data" = `effectiveType === null && downlink === null && rtt === null`.
- In that case, when `isOnline === true`, return a new `'unknown'` quality that renders as a plain Wifi icon with label "Online" (or just hides entirely on small screens).
- Keep the existing `'poor'` bucket only for cases where the API *did* report data and that data is genuinely poor.

This single change fixes the screenshot for every iOS/Safari user.

**F2 — Make the "Poor"/quality badge less prominent on mobile**

The badge today renders the icon always and only hides the label on `<sm` screens. On the iPad (`sm` and up) the full badge shows. Since network quality is a soft diagnostic, not an action item:
- Hide the entire `NetworkQualityIndicator` on mobile/tablet viewports unless quality is truly degraded (`fair` or worse with verified API data) **or** the device is offline. Desktop keeps it.
- Already wrapped in `<div className="hidden sm:flex">` — change to `hidden lg:flex` and add an inner conditional so it only renders when there's something interesting to say.

**F3 — Make the "2 pending" chip self-explanatory**

The chip currently has no tooltip. Add one that says: *"2 items queued. They'll sync automatically when conditions allow. Tap to sync now."* Make the chip clickable to call `forceSync()` (which is already exposed by `usePWA`). This turns a scary indicator into a reassuring + actionable one.

Optional: change the color from amber to a calmer slate/blue when `isOnline === true && !syncError` — amber reads as "warning," but a queued upload on a healthy connection isn't a warning, it's just status.

**F4 — Defensive: confirm `useNetworkStatus` isn't masking real signal**

Verified: `useNetworkStatus.tsx` correctly trusts `navigator.onLine` and only nullifies `effectiveType`/`downlink`/`rtt` when the API is missing. No change needed here.

### Files to change

- `src/components/pwa/NetworkQualityIndicator.tsx` — F1 (add `'unknown'` bucket, treat null-API as unknown, not poor) + F2 (render-gating helper).
- `src/pages/Dashboard.tsx` — F2 (`hidden lg:flex` + conditional render) + F3 (tooltip on amber chip + `onClick={forceSync}` + neutral color when healthy).

No other components touch these badges. ~25 LOC net.

### Risk

- **F1:** A genuinely slow connection on a browser without the Network Info API will no longer show "Poor." That signal was already unreliable on Safari, so we're trading a false-positive for a true-unknown — net better.
- **F2:** Less screen real estate spent on diagnostics on mobile. Users who *want* the indicator can still see it at desktop sizes and inside the SyncDiagnosticsSheet.
- **F3:** Adding `onClick` to the amber chip — must guard against double-tap during in-flight sync (disable while `isSyncing`).

### Expected outcomes

- iPad / iPhone / Safari users no longer see the misleading "Poor" badge.
- Desktop Chrome/Edge keeps accurate quality reporting where the API exists.
- The "2 pending" chip becomes informative + actionable rather than alarming.
- No change to actual sync behavior — purely a UI honesty fix.

### Verification

1. Open dashboard on iPad Safari → no "Poor" badge.
2. Open on desktop Chrome with throttled "Slow 3G" in DevTools → "Fair" or "Poor" still shows correctly.
3. Open on desktop Chrome on real wifi → "Excellent" still shows.
4. Toggle airplane mode → "Offline" badge shows on all platforms (unchanged).
5. Create a record offline, come online → amber "1 pending" chip appears, tap it → `forceSync` runs, chip clears.
6. Hover/long-press the amber chip → tooltip explains it's queued, not broken.

