## Why the dashboard flickers

The flicker isn't the brutalist 2px loading bar — that only renders on first mount. It's the **reports list and StatsBar repainting every few seconds**. Three independent issues compound on `/dashboard`:

### Root cause 1 — Refresh storm with no coalescer

`refreshReports(true)` is wired up to **seven** triggers in the same effect (Dashboard.tsx 433–615):

- initial mount
- `online` event
- `focus` event
- `pageshow` (bfcache restore)
- `visibilitychange → visible`
- `dashboard-stale` custom event
- `onSyncComplete` (fires every auto-sync — your replay shows one every ~50s)
- realtime channel error fallback (`setTimeout(refreshReports, 1500)`)

There's no debounce and no "already in flight" guard. Tab focus + a sync completing + a realtime status flap can fire 3 refreshes within a second, each restarting the full inspections / trainings / daily-assessments pipeline. The console snapshot shows three back-to-back `Network query timed out after 15000 ms` from the same line — that's the storm.

### Root cause 2 — Stale-while-revalidate replaces the array even when data is identical

Each branch of `refreshReports` runs the same shape (Dashboard.tsx 847–862, 994, 999):

```ts
setInspections(offlineData);   // first paint from IDB
...
setInspections(networkData);   // second paint from Supabase
```

Both calls hand React a **brand-new array reference** even when every row's `id` + `updated_at` is unchanged. `DashboardReportsSection` is not memoized against value-equality, so its child rows unmount/remount on every refresh, which is what the eye perceives as the flicker (badges blink, hover state drops, scroll jiggles). With Root cause 1 layered on top, this happens many times a minute.

### Root cause 3 — Validation flags flip on every realtime event

`setInspectionsValidated(true)` / `setTrainingsValidated(true)` / `setDailyValidated(true)` (Dashboard.tsx 667, 682, 697) are called unconditionally inside each realtime payload handler. They're already `true` after the first refresh, but React still schedules a render because the setter is invoked from a different commit. Combined with realtime payloads arriving for every other tab-mate's edit (admin) or your own writes mirrored back, this is another constant source of re-renders that flow through the StatsBar.

### Supporting evidence

- **Console:** three sequential `[Dashboard] Network query timed out after 15000 ms` — only possible if refresh is being called repeatedly while the previous one is still pending.
- **Session replay:** the sync chip pulses, returns green, idles, pulses again ~50 s later. Each pulse is an `onSyncComplete` → `refreshReports(true)` → double `setInspections` → list remount.
- **Dashboard.tsx 615:** the giant mount effect has `[]` deps but reads `currentUser`, `isSuperAdmin`, etc. via closure — so it captures stale handlers but they still re-fire on every event.

### Why it's worse for some users

Admins (and Luke specifically) hit it harder because their realtime channel is **unfiltered** (line 658) — they receive every tenant's row event, and each one trips the validation-flag setter and the row-merge setter. On a normal user with the `inspector_id=eq.${userId}` filter, the cadence is much lower.

---

## Proposed fix (no code yet — confirm before I implement)

All edits inside `src/pages/Dashboard.tsx`. No schema, no edge function, no realtime wiring change.

### 1. Coalesce refresh triggers

Add a small in-file helper:

```ts
const refreshInFlightRef = useRef<Promise<unknown> | null>(null);
const refreshScheduledRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const requestRefresh = useCallback(() => {
  if (refreshInFlightRef.current) return;          // already running
  if (refreshScheduledRef.current) return;         // already queued
  refreshScheduledRef.current = setTimeout(() => {
    refreshScheduledRef.current = null;
    refreshInFlightRef.current = refreshReports(true)
      .finally(() => { refreshInFlightRef.current = null; });
  }, 250);
}, []);
```

Replace the seven `refreshReports(true)` call sites in the mount effect with `requestRefresh()`. Initial mount stays as a direct `refreshReports(true)` so the first paint isn't delayed.

### 2. Skip `setInspections` when the payload is unchanged

Introduce one tiny utility at the top of the file:

```ts
const sameRows = (a: DbRow[], b: DbRow[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if ((a[i].updated_at ?? '') !== (b[i].updated_at ?? '')) return false;
  }
  return true;
};
```

Wrap each `setInspections / setTrainings / setDailyAssessments` call inside `refreshReports` with a functional setter that returns `prev` when `sameRows(prev, next)` — React then bails out without scheduling a render. Six call sites total (2 per table — offline + network). Cache writes to `dashboard-cache-*` stay outside the bail-out so disk stays warm.

### 3. Stop re-flipping `*Validated` flags

In each realtime handler (Dashboard.tsx 667, 682, 697) gate the setter:

```ts
setInspectionsValidated(prev => prev ? prev : true);
```

(The functional updater bails when value is unchanged — same render-skip mechanism as above.)

### 4. (Tiny) memo `DashboardReportsSection`

If the component file isn't already wrapped in `React.memo`, wrap it. With root cause 2 fixed the parent will stop handing it new array refs on no-op refreshes, so the memo will actually hit.

### Out of scope

- No changes to `refreshReports` algorithm, timeouts, retries, orphan cleanup, or reconciliation logic.
- No changes to realtime subscription scope (PR-D filter stays).
- No new memory entry needed — these are local rendering hygiene fixes.

### Validation

- Add a vitest under `src/pages/__tests__/dashboard-coalescer.test.ts` that fires `focus + visibilitychange + onSyncComplete` within 100ms and asserts `refreshReports` was invoked **once**.
- Add an assertion-only test for `sameRows` covering: identical, length-diff, id-diff, updated_at-diff.
- Manual check in preview: open `/dashboard`, alt-tab away and back 5×, confirm reports list does not visibly repaint (no badge flash, no scroll jiggle).
