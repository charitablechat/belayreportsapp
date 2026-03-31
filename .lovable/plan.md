

## Comprehensive Audit: Remaining Dashboard Refresh Bugs

### Bugs Found

**Bug 1 — `dispatchDashboardRefresh()` fires before Dashboard mounts (event is lost)**

All three report forms call `dispatchDashboardRefresh()` then `navigate('/dashboard')`. Since `goBack()` always does `navigate("/dashboard")` (forward navigation, not `navigate(-1)`), this unmounts the report form and mounts the Dashboard. But the `dashboard-refresh` custom event is dispatched WHILE the report form is still the active component — Dashboard hasn't mounted yet and has no listener registered. The event is lost every time.

**Bug 2 — `consumePendingDashboardRefresh()` triggers a redundant, throttle-blocked call**

Line 350: `if (consumePendingDashboardRefresh()) { setTimeout(() => refreshReports(true), 300); }` — but `refreshReports(true)` is already called at line 287. When the 300ms timer fires, `refreshInFlightRef.current` is still `true` (the first call is still awaiting the 8s session validation), so the pending refresh returns immediately at line 222. The pending mechanism is a no-op.

**Bug 3 — `refreshReports` is a stale `useCallback(fn, [])` — `loadInspections` etc. capture the initial closure**

`refreshReports` is created with `useCallback(async () => { ... }, [])`. Inside it, `loadInspections`, `loadTrainingReports`, and `loadDailyAssessments` are plain functions defined in the component body. Because `useCallback` with `[]` deps captures the closure from the first render, these function references are always the first-render versions. This means the `sessionValid` argument works (it's passed directly), but any future changes to referenced state could produce stale reads. Currently not an active bug, but fragile.

**Bug 4 — `popstate` never fires for SPA `navigate('/dashboard')`**

`popstate` fires when the browser's history is traversed (back/forward button). Since `goBack()` calls `navigate("/dashboard")` which is a `pushState`, not a `popstate`, the `handlePopState` listener never triggers during normal report-to-dashboard navigation. It only fires if the user uses the browser/device back button.

**Bug 5 — 2-second IndexedDB timeout returns `[]`, bypassing stale-while-revalidate**

When IndexedDB is slow (common on iOS after a long form session), the 2s timeout resolves to `[]`. The guard `if (offlineData.length > 0)` fails, so the stale-while-revalidate step is completely skipped. If sessionStorage cache is also expired (>30 min), the user sees empty state for the full duration of the network request (8-15s).

**Bug 6 — sessionStorage cache expires, initial state is `[]`, no fallback**

`readDashboardCache` returns `[]` when TTL expires. The `useState(() => readDashboardCache(...))` initializer sets state to `[]`. There is no secondary fallback (e.g., localStorage) to provide data while the network loads.

**Bug 7 — `navigator.onLine` can be briefly `false` during iOS page transitions**

On iOS Safari, `navigator.onLine` can momentarily report `false` during in-app navigation. If `refreshReports` runs during this window, `sessionValid` stays false (session validation is skipped), AND all network queries are skipped. The result is empty data with no recovery until a focus/visibility event fires.

### Solution

#### 1. `src/pages/Dashboard.tsx` — Replace lost event with sessionStorage timestamp

Remove reliance on `dispatchDashboardRefresh()` custom event. Instead, report forms write a timestamp to sessionStorage. Dashboard reads it on mount and uses it to decide if data is definitely stale (force network refresh even if cache looks valid).

#### 2. `src/pages/Dashboard.tsx` — Add localStorage as a long-lived cache fallback

When sessionStorage cache is expired, fall back to localStorage which stores the last-known-good data indefinitely. Update `readDashboardCache` to check localStorage as a secondary source. Write to both sessionStorage and localStorage on every successful data load.

#### 3. `src/pages/Dashboard.tsx` — Increase IndexedDB timeout to 4s; add localStorage data as fallback for `[]` results

When IndexedDB times out with `[]`, check localStorage backup before accepting empty state. This ensures the stale-while-revalidate pattern always has data to show.

#### 4. `src/pages/Dashboard.tsx` — Add `navigator.onLine` delayed recheck

If `navigator.onLine` is `false` at the start of `refreshReports`, schedule a 1s delayed recheck. If it flips to `true`, restart with network queries enabled.

#### 5. `src/pages/Dashboard.tsx` — Remove dead `popstate` and `dashboard-refresh` listeners

These never fire during normal SPA navigation. Remove them to reduce confusion. Keep `visibilitychange`, `focus`, `pageshow`, and `online` which DO work.

#### 6. `src/lib/sync-events.ts` — Remove `dispatchDashboardRefresh` (dead code)

Replace with a `markDashboardStaleTimestamp()` that writes `Date.now()` to sessionStorage, which Dashboard can read on mount.

#### 7. Report form pages — Replace `dispatchDashboardRefresh()` with timestamp marker

Update `InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx` to call `markDashboardStaleTimestamp()` instead of `dispatchDashboardRefresh()`.

### Files Modified
| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | localStorage fallback cache, increased IDB timeout, online recheck, remove dead listeners |
| `src/lib/sync-events.ts` | Replace `dispatchDashboardRefresh` with `markDashboardStaleTimestamp` |
| `src/pages/InspectionForm.tsx` | Use `markDashboardStaleTimestamp` |
| `src/pages/TrainingForm.tsx` | Use `markDashboardStaleTimestamp` |
| `src/pages/DailyAssessmentForm.tsx` | Use `markDashboardStaleTimestamp` |

