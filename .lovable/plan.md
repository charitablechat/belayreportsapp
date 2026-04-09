
What I found

- The earlier “Recent Reports only searches top 9” bug is not the blocker for this record anymore.
- The restored row does exist in the database:
  - organization: `Airiel Crawler World`
  - assessment_date: `2026-02-20`
  - updated_at: `2026-04-09`
  - `deleted_at = null`
- There are only 7 active daily assessments total, so this record should still be in the Daily “Recent Reports” set. That means the missing row is now caused by a different gap.
- The screenshot search term is `ariel`, but the stored organization is `Airiel`. Current search is strict substring matching only, so `ariel` will not match `airiel`.
- Console logs also show repeated 15s dashboard query timeouts. When that happens, the dashboard keeps stale cached data. Since restore currently does not hydrate caches directly, the restored row never reaches dashboard state if the bulk refresh times out.
- There is also a likely permissions mismatch: restore is allowed via `is_admin_or_above()`, but report SELECT visibility is still owner/`is_super_admin()` based on current table policies. If the restoring user is admin-but-not-true-super-admin and not the report owner, they can restore the row but still not see it on the dashboard.

Plan

1. Fix the real visibility path after restore
- Update `src/hooks/useSoftDelete.tsx` so `restoreRecord` returns the restored row payload, not just success/failure.
- Update `src/components/admin/DeletedRecordsRecovery.tsx` to persist a “restored report” marker/payload, not just fire a transient `dashboard-stale` event.
- On Dashboard load in `src/pages/Dashboard.tsx`, consume that marker and merge the restored record into React state and dashboard caches immediately.

2. Add a targeted fallback fetch for restored records
- In `src/pages/Dashboard.tsx`, when a pending restored record exists, run a direct fetch by report ID instead of relying only on the large bulk `daily_assessments` query.
- If the bulk query times out, the targeted fetch should still insert/update that single report in state, session cache, local cache, and offline storage.

3. Align search behavior with what users type
- Update `textMatchesReport` in `src/components/dashboard/DashboardReportsSection.tsx`.
- Keep exact match first, then add normalized/fuzzy matching for organization/location/assignee so `ariel` can match `Airiel`.
- Also search token-by-token so `crawler` and `world` match independently.

4. Close the admin visibility/RLS gap
- Add/adjust backend SELECT policies so the same admin tier that can restore reports can also read them on the dashboard.
- Apply the same rule consistently to:
  - `public.daily_assessments`
  - `public.trainings`
  - `public.inspections`
- Preferred fix: add admin-level SELECT policies using the existing server-side role check, instead of relying only on owner/true-super-admin visibility.

5. Keep the timeout hardening, but don’t treat it as the only fix
- Keep the stale banner and queued refresh logic.
- Only reduce the session-validation timeout if logs prove auth is the slow step.
- The main issue is that restore currently depends on a slow bulk refresh to make the row visible.

Files to change

- `src/hooks/useSoftDelete.tsx`
- `src/components/admin/DeletedRecordsRecovery.tsx`
- `src/pages/Dashboard.tsx`
- `src/components/dashboard/DashboardReportsSection.tsx`
- new backend migration for admin SELECT policy alignment

Why this should solve it

- If the row is restored but bulk dashboard fetch is slow, the targeted restore hydration will still surface it.
- If the user types `ariel`, fuzzy/normalized search will still find `Airiel`.
- If the restoring user is allowed to restore but not currently allowed to view, aligned SELECT policies will remove that contradiction.

Validation

- Restore `Airiel Crawler World` and confirm it appears on the dashboard before a full bulk refresh completes.
- Search for:
  - `airiel`
  - `ariel`
  - `crawler`
  - `aspen`
- Verify the row appears in:
  - Daily tab
  - cross-tab search
  - Recent Reports
- Test with:
  - report owner
  - admin
  - true super admin
- Simulate network timeout and confirm the restored row still becomes visible from the targeted fallback path.
