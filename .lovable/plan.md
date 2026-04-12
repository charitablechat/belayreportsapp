

# Audit Results — One Remaining Gap

## What's Working Correctly ✓

1. **Stats bar validation** — `DashboardStatsBar` correctly uses `dataValidated` with per-tab flags and shows skeleton placeholders when not validated.

2. **Stats computed from full data** — `statsData` memo uses `allInspections ?? inspections` (full datasets), not sliced arrays.

3. **Overdue computed from full data** — Now uses inline date-based logic on `fullData`, independent of `useDashboardFilters`.

4. **Per-tab validation flags** — Dashboard passes `inspectionsValidated`, `trainingsValidated`, `dailyValidated` individually. Stats bar receives the correct per-tab flag.

5. **`emitSyncComplete` removed** — All three forms now use only `markPendingDashboardRefresh()` + `markDashboardStaleTimestamp()`. Confirmed via search.

6. **`bypassAndProceed` removed** — No references remain in any form. Confirmed via search.

7. **Auth consistency** — All three forms use the same simplified `getUserWithCache()` + `getOfflineUserId()` pattern. No `ensureValidSession` in any form's `fetchUser`.

8. **Navigation logic** — `SaveBeforeLeaveDialog` in all forms uses a single `navigate('/dashboard')` after save/leave. No duplicate navigation calls.

9. **Definitive validation** — `setInspectionsValidated(true)` only fires when `results[0].definitive` is true. Server-confirmed empty (`[]` with valid session) correctly returns `definitive: true`.

10. **Server-confirmed empty** — Line 746-750: when `networkData` is `[]` (not `null`) and session is valid, state is set to `[]` and marked definitive. This correctly handles zero-report users.

---

## One Remaining Issue: Tab Count Labels Show `0` Before Validation

**Location**: `DashboardReportsSection.tsx` lines 554, 558, 562

```typescript
Inspections ({loading ? '…' : (totalInspections ?? inspections.length)})
```

**Problem**: When `loading` is `false` but `inspectionsValidated` is still `false`, Dashboard passes `totalInspections = undefined`. The `??` fallback then renders `inspections.length` — which can be `0` during the revalidation window.

This means the tab badge can briefly flash `0` after loading completes but before validation confirms. The stats bar correctly shows skeletons during this window, but the tab labels do not.

**Fix**: Show `…` when `totalInspections` is `undefined` (not just when `loading`):

```typescript
// Line 554
Inspections ({totalInspections !== undefined ? totalInspections : '…'})
// Line 558
Training ({totalTrainings !== undefined ? totalTrainings : '…'})
// Line 562
Daily ({totalDailyAssessments !== undefined ? totalDailyAssessments : '…'})
```

Remove the `loading ? '…' :` prefix since the `undefined` check now covers both loading and pre-validation states.

**Risk**: None — the `totalX` props transition from `undefined` → number exactly once per load cycle.

---

## Files to Update

1. **`src/components/dashboard/DashboardReportsSection.tsx`** — Fix tab count labels (lines 554, 558, 562) to check `!== undefined` instead of `loading`

## Summary

The codebase is in good shape after the previous rounds. The only remaining gap is cosmetic: tab labels can briefly show `0` between the loading spinner ending and per-dataset validation completing. One three-line change resolves it.

