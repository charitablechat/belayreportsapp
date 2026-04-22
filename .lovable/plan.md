

## Why "Edited X days ago" is stuck across devices

The pink "Edited 19 days ago" pill on each dashboard report card is rendered from `report.updated_at` in `ReportCard.tsx`:

```ts
const getLastActivity = () => {
  const updatedAt = report.updated_at;
  if (!updatedAt) return null;
  return formatDistanceToNow(new Date(updatedAt), { addSuffix: true });
};
```

Three independent issues keep that string frozen on the iPad while the HP shows the right value:

### Root cause #1 — Dashboard state is not refreshed by Realtime

`Dashboard.tsx` keeps its lists in plain `useState` (`inspections`, `trainings`, `dailyAssessments`) populated by `refreshReports()`. That function only runs on:

- `online` event, `focus`, `visibilitychange`, `pageshow` (bfcache), the `dashboard-stale` event, and `onSyncComplete`.

`useAutoSync.handleRemoteChange` (the Realtime hook) does two things on a remote UPDATE:

1. Writes the new payload to IndexedDB.
2. Calls `queryClient.invalidateQueries({ queryKey: ['inspections'] })` — but **the Dashboard never subscribes to that React Query key**; its lists are local state.

So when the HP edits Solid Rock and the iPad receives the Realtime UPDATE, IDB updates silently, the Dashboard's in-memory `inspections` array keeps the old `updated_at`, and the pill keeps saying "19 days ago" until the user backgrounds and re-foregrounds the tab.

### Root cause #2 — The relative string never re-renders on its own

`formatDistanceToNow` is computed once per render and never refreshed. A dashboard left open shows a fixed "Edited 19 days ago" indefinitely because nothing forces ReportCard to re-render as wall-clock time advances. After yesterday's edit and an idle 24 hours, the pill should say "20 days ago" but still says "19".

### Root cause #3 — Stale-while-revalidate paints an old `updated_at` first

In `loadInspections`, IDB data is rendered before the Supabase query returns (lines 641–648). If the local IDB row was last written by a Realtime payload, its `updated_at` is correct. But if it was written by `saveInspectionOffline` after a previous sync where only `synced_at` was aligned (via `align_synced_at` RPC), the local copy can hold an older `updated_at` than the server. The pill then shows the older time until the network call resolves and overwrites it. On flaky networks this older value sticks.

There is also a related bug: the `dashboard-stale` event is dispatched after `align_synced_at` finishes, but only on the *originating* device. Other devices have to wait for their own next focus/visibility tick.

---

## Fix

### F1 — Wire Realtime updates into Dashboard state (the actual cross-device bug)

Add a Realtime subscription inside `Dashboard.tsx` that listens for `postgres_changes` UPDATE events on `inspections`, `trainings`, and `daily_assessments`, and merges the payload into the corresponding `useState` array by `id`. Write logic:

```ts
const merge = (prev, row) =>
  prev.some(r => r.id === row.id)
    ? prev.map(r => r.id === row.id
        ? { ...r, ...row, updated_at: row.updated_at, synced_at: row.updated_at }
        : r)
    : [row, ...prev];
```

This guarantees `report.updated_at` in the rendered card matches the latest server value within ~1 second of any remote edit, on every connected device. Profile join data (`inspector`/`trainer`) is preserved by spreading existing fields first.

Also handle DELETE → filter the row out.

### F2 — Re-render relative timestamps on a tick

Add a small `useElapsedTick()` hook in `ReportCard.tsx` that forces a re-render once a minute (single shared interval, mounted via context or a module-level subscriber to avoid N intervals for N cards). This makes "19 days ago" advance to "20 days ago" without user interaction. Cost: one timer for the whole dashboard, ~one re-render/min.

### F3 — Dashboard cache writeback must not regress `updated_at`

In `loadInspections` (and the training/daily equivalents), when writing the network row to IDB, **always preserve the larger of `local.updated_at` vs. `server.updated_at`** — never let an older local value overwrite a newer server value. Currently the code writes `{ ...inspection, synced_at: preservedSyncedAt }` which is fine for `synced_at`, but doesn't guard against an IDB row with a stale `updated_at` shadowing a fresher server one in a follow-up read.

Pair with: when `useAutoSync.handleRemoteChange` persists a Realtime payload to IDB, also dispatch a lightweight `dashboard-stale` event so the Dashboard's existing handler runs `refreshReports()` as a backstop. (Cheap; deduped by `lastRefreshTsRef`.)

### F4 — Tooltip with absolute time

Wrap the "Edited X" pill in a Tooltip that shows the absolute timestamp (`format(new Date(updated_at), 'PPpp')`). Eliminates ambiguity when the relative string is briefly out of date.

### Files to change

- **`src/pages/Dashboard.tsx`** — F1 (Realtime subscription with merge handler) + F3 (preserve `updated_at` in IDB writeback).
- **`src/components/dashboard/ReportCard.tsx`** — F2 (minute-tick re-render) + F4 (tooltip on the Edited pill).
- **`src/hooks/useAutoSync.tsx`** — F3 (dispatch `dashboard-stale` after persisting Realtime payload).

No DB migrations, no edge functions. ~80 LOC net.

### Risk

- **F1:** One extra Realtime subscription per dashboard mount, scoped to three tables. Same channel pattern already used by form pages — no new pressure.
- **F2:** A single 60s timer for the whole dashboard. No measurable cost; immediately cleared on unmount.
- **F3:** Stricter "local writeback" — if a future code path intentionally sets a backdated `updated_at` it will be ignored. No such path exists today.

### Verification

1. iPad with dashboard open → HP edits Solid Rock → within ~1 s the iPad's Solid Rock card flips to "Edited a few seconds ago". (Today: stays at "19 days ago".)
2. Leave dashboard open for 60 s → "a few seconds ago" advances to "a minute ago" without interaction. (Today: frozen.)
3. Hover/long-press the Edited pill → tooltip shows full ISO date/time.
4. Open dashboard offline → pill renders from IDB; reconnect → pill stays the same value (no flicker to an older time).
5. HP creates a brand-new inspection → iPad's dashboard shows the new card via Realtime INSERT (already partially worked; now confirmed via merge path).
6. Delete a record on HP → iPad's card disappears within ~1 s.
7. Phantom-pending fix (last cycle) still works: pending count unchanged.

