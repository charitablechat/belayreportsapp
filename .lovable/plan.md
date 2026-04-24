## Fix all 5 issues with Dashboard running-total cards

Implement the five fixes identified in the root-cause analysis. All are scoped to two files: `src/pages/Dashboard.tsx` and `src/components/dashboard/DashboardReportsSection.tsx`. No schema or RLS changes — `inspections`, `trainings`, and `daily_assessments` are already in the `supabase_realtime` publication (verified).

### Fix 1 — Validate after every refresh, not only on `definitive: true`

In `Dashboard.tsx` `refreshReports` (around lines 362-393), change the per-dataset validation from "only flip true on definitive" to "always flip true once the load function returns." This kills the "skeleton forever" symptom when network times out and IDB is empty.

```ts
setInspectionsValidated(true);
setTrainingsValidated(true);
setDailyValidated(true);
```

Wrap in a `try/catch` so even a thrown error still flips the flags true (we'd rather show stale cached numbers than infinite skeletons).

### Fix 2 — Don't reset validation flags on focus / online / sync refreshes

The reset already only happens in the initial-mount `useEffect` (lines 397-399), so this is mostly already correct. Add a one-line guard: change those resets to only run if cached arrays are empty, so users coming back to the tab don't briefly see skeletons before data re-validates.

### Fix 3 — Invoiced-tab stats memo uses the right source

In `DashboardReportsSection.tsx` `statsData` `useMemo` (lines 259-277), the invoiced branch reads `currentReports` (already filtered/sliced). Change it to read the full `invoicedReports.map(r => r.report)` source and add `invoicedReports` to the dependency array so the stats recompute when invoiced data loads asynchronously.

### Fix 4 — Realtime health check

In `Dashboard.tsx` (around line 624), change `.subscribe()` to `.subscribe((status) => { ... })` so we log subscription state. If status is `CHANNEL_ERROR` or `TIMED_OUT`, set a small "realtime degraded" flag and trigger a one-shot `refreshReports(true)` as a fallback. No new UI surface — just a console warning and an automatic refetch.

### Fix 5 — Realtime merges also flip validation true

In the `mergeRow` postgres_changes handlers (lines 580-624), call `setInspectionsValidated(true)` / `setTrainingsValidated(true)` / `setDailyValidated(true)` inside each table's handler. This guarantees that any incoming row also un-skeletonizes the stats bar — belt-and-suspenders against fix 1's path being skipped.

### Files touched

| File | Changes |
|---|---|
| `src/pages/Dashboard.tsx` | Fixes 1, 2, 4, 5 — validation logic in `refreshReports`, mount-only reset guard, realtime subscribe callback + flag flips inside mergeRow handlers |
| `src/components/dashboard/DashboardReportsSection.tsx` | Fix 3 — `statsData` `useMemo` invoiced-branch source + deps |

### Verification

- Open dashboard offline with empty IDB: cards show real `0` instead of pulsing skeleton forever.
- Network timeout on a flaky connection: cards show whatever cache held, then update silently when network recovers.
- Switch to Invoiced tab: TOTAL card matches the `Invoiced (N)` tab label.
- Edit a report on a second device: realtime payload updates the count on the first device within ~1s, and if it was somehow skeletonized, it un-skeletonizes.
- Realtime drop: console logs `CHANNEL_ERROR`/`TIMED_OUT`, dashboard auto-refetches.

### Risk

Low. All changes are additive (more permissive validation, extra useMemo dep, extra subscribe callback). No data writes. No type changes. Pre-existing TypeScript errors in `atomic-sync-manager.ts` / `local-backup-ledger.ts` / `cached-auth.ts` are unrelated and untouched.
