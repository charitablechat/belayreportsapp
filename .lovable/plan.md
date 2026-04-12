
Goal: fix the real root causes of stale report state and incorrect dashboard counts, then clean up the related state-handling gaps that can still produce misleading UI.

What I found
1. The earlier dashboard fix is only partial.
   - `DashboardStatsBar` already supports `dataValidated`, but `Dashboard.tsx` still does `setDataValidated(true)` unconditionally in `refreshReports(...).finally`.
   - That means a failed/timed-out/non-definitive refresh is still marked “validated”, so the UI can stop showing placeholders and render zeros/empty state too early.

2. The loaders still cannot distinguish “real empty” from “timeout/failure”.
   - Each `load*` function races IndexedDB against a timeout and falls back to `[]`.
   - Right now `[]` can mean either:
     - there are truly zero reports, or
     - IndexedDB timed out / never returned in time.
   - That ambiguity is a major reason stale state and false zero states persist.

3. Real zero results are handled incorrectly in more than one place.
   - Tab labels use truthy checks like `!totalInspections`, so a legitimate `0` is treated like “not loaded”.
   - The network-empty branches still preserve previous state with patterns like `setInspections(prev => prev.length > 0 ? prev : [])`, which prevents a true server-confirmed empty result from clearing stale data.

4. Dashboard stats are not truly aggregated in “Recent” mode.
   - `DashboardReportsSection` computes stats from `currentReports`, but in “9 Most Recent Reports” mode those arrays are sliced before being passed in.
   - So the stats bar can describe only the recent slice instead of the full dataset.

5. Report exit flows still send a misleading sync signal.
   - `InspectionForm`, `TrainingForm`, and `DailyAssessmentForm` call `emitSyncComplete()` during “Save & Exit”.
   - That event is supposed to mean background sync actually finished, but here it fires after local save-before-leave.
   - This can trigger premature dashboard refreshes and extra refresh races.

6. There are still form consistency gaps.
   - `InspectionForm` mount auth is now simpler, but `TrainingForm` and `DailyAssessmentForm` still use the stricter `ensureValidSession()` path when fetching the current user on mount.
   - Not the main dashboard bug, but it keeps behavior inconsistent across report types.

Implementation plan

Phase 1 — Fix dashboard load-state correctness
- Replace the single boolean `dataValidated` with per-dataset validation state in `Dashboard.tsx`, e.g. inspections/training/daily each track:
  - pending
  - validated
  - stale/unverified
- Make each `load*` function return structured status, not just `networkSuccess`, so the dashboard knows whether the result was:
  - offline definitive
  - network definitive
  - timeout
  - failed
  - confirmed empty
- Only mark a dataset validated when the result is truly definitive.
- Stop setting dashboard validation state blindly in `finally`.

Phase 2 — Fix zero/empty semantics
- Change the IndexedDB timeout handling so `[]` from a timeout is not treated the same as a true empty result.
- Update the “server returned zero rows” branches to explicitly clear state when the server response is definitive and session is valid.
- Fix tab label rendering so legitimate zero counts render `0` instead of `…`.
- Update cache read/write logic so a validated empty result can be cached as a real state, not discarded as “no cache”.

Phase 3 — Fix aggregated dashboard numbers
- In `DashboardReportsSection.tsx`, compute stats from the full dataset for the active tab (`allInspections`, `allTrainings`, `allDailyAssessments`), not from the recent sliced arrays.
- Keep the cards/list sliced for “Recent”, but keep counts/stats based on full data.
- Gate stats visibility on the active tab’s validation status so placeholders stay visible until that tab is definitively loaded.

Phase 4 — Remove stale refresh races from report exit
- In all 3 report forms:
  - remove manual `emitSyncComplete()` from Save-before-leave
  - keep `markPendingDashboardRefresh()` / `markDashboardStaleTimestamp()` as the single source of truth for dashboard refresh-on-return
- This prevents false “sync complete” signals and reduces duplicate refreshes while navigating back.

Phase 5 — Harden save-before-leave state handoff
- Refine the save-before-leave flow so “Save & Exit” guarantees local persistence before navigation, without waiting on the full remote sync path.
- Preserve the current escape hatch so users can still leave even if sync is slow/hanging.
- This keeps report edits available immediately when the dashboard reloads.

Phase 6 — Consistency cleanup
- Align `TrainingForm` and `DailyAssessmentForm` mount auth/user-fetch behavior with the simplified non-blocking pattern already used in `InspectionForm`.
- Remove unused `bypassAndProceed` imports/usages if they are no longer part of the exit flow.

Files to update
- `src/pages/Dashboard.tsx`
- `src/components/dashboard/DashboardReportsSection.tsx`
- `src/components/dashboard/DashboardStatsBar.tsx`
- `src/pages/InspectionForm.tsx`
- `src/pages/TrainingForm.tsx`
- `src/pages/DailyAssessmentForm.tsx`
- possibly `src/lib/sync-events.ts` if I centralize the dashboard-refresh handoff semantics

Expected outcome
- No more false zero counts after leaving reports
- Real zero results display correctly as `0`
- Dashboard stats remain accurate in both “Recent” and “All Reports”
- Stale data is only replaced when the refresh result is actually definitive
- Returning from a report produces one clean refresh path instead of overlapping signals
- All three report forms behave consistently around auth, local save, and exit

Validation after implementation
- Edit each report type, Save & Exit, and confirm dashboard updates immediately
- Test Exit without save
- Test offline with existing cached reports
- Test offline with no cached reports
- Test true zero-report users
- Test Recent vs All counts
- Test queued/offline save followed by later sync completion
