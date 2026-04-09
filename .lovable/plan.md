
Root cause found: the restored report does exist in the backend, but Dashboard search is only searching the lists already passed into `DashboardReportsSection`. In `src/pages/Dashboard.tsx`, those lists are trimmed to the 9 most recent reports whenever `reportSection === "recent"`:
- `baseInspections = ...slice(0, 9)`
- `baseTrainings = ...slice(0, 9)`
- `baseDailyAssessments = ...slice(0, 9)`

Then `DashboardReportsSection` builds cross-tab search from those already-truncated arrays:
- `crossTabResults.inspections = inspections.filter(...)`
- `crossTabResults.trainings = trainings.filter(...)`
- `crossTabResults.daily = dailyAssessments.filter(...)`

So if “Airiel Crawler World” is not in the current top 9 for that tab set, search returns 0 even though the record exists. In this case, the restored daily assessment is actually the newest in the backend, but the current code still has a structural bug: search scope depends on the Recent/All toggle, which can hide valid restored records and any older records.

Plan:
1. Fix search scope in `src/pages/Dashboard.tsx`
   - Keep the existing “Recent Reports” slicing for normal browsing.
   - But when passing data into `DashboardReportsSection`, also pass the full datasets (`inspections`, `trainings`, `dailyAssessments`) separately for search.
   - Do not let cross-tab search depend on the sliced “recent” arrays.

2. Update `src/components/dashboard/DashboardReportsSection.tsx`
   - Add props for full report collections, e.g. `allInspections`, `allTrainings`, `allDailyAssessments`.
   - Change `crossTabResults` to search those full collections instead of the currently displayed subset.
   - Keep normal tab browsing, filters, pagination, and counts unchanged for the visible tab.

3. Make restore visibility deterministic
   - After a restore, keep the existing `dashboard-stale` refresh trigger.
   - Add a small safeguard so if search is active, the search view always searches full data regardless of “Recent/All”.
   - This ensures restored records are discoverable immediately, even if they are older or outside the recent slice.

4. Optional resilience improvement
   - Normalize search text for typos/spacing/case only if needed later, but not as the first fix.
   - Current search already does case-insensitive substring matching, so the main issue is search scope, not matching logic.

Technical details:
- File 1: `src/pages/Dashboard.tsx`
  - Today:
    ```text
    full data -> slice to 9 in Recent mode -> pass sliced arrays into DashboardReportsSection
    ```
  - Fix to:
    ```text
    full data -> slice only for visible cards
              -> also pass full arrays for search
    ```
- File 2: `src/components/dashboard/DashboardReportsSection.tsx`
  - Today:
    ```text
    crossTabResults uses props.inspections/trainings/dailyAssessments
    ```
  - Fix to:
    ```text
    crossTabResults uses props.allInspections/allTrainings/allDailyAssessments
    normal tab content still uses currentReports from visible arrays
    ```

Expected outcome:
- Searching “ariel”, “airiel”, or “crawler world” will return restored records as long as they are loaded in Dashboard data.
- Recent mode will still show only the top 9 visually, but search will no longer be artificially limited.
- Restored reports will be accessible immediately after restore instead of appearing “missing.”

Validation after implementation:
- Restore a deleted older report and search for it while still on “Recent Reports”.
- Verify it appears in cross-tab search results.
- Verify “All Reports” behavior is unchanged.
- Verify mobile and desktop search both behave the same.
