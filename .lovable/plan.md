# Fix "Unknown" inspector names on dashboard cards (Option B)

## What's wrong (confirmed)

- The database **has** the names. Direct query returned `Luke Benton` for the pink draft cards and `Test Account` for the `[E2E DEVIN]` card.
- `ReportCard.getInspectorName()` reads `report.inspector.first_name` / `report.inspector.last_name`. That `inspector` field only exists when the row was just fetched by `Dashboard.loadInspections` (which adds `inspector:profiles!...` to the select).
- Every other writer to the inspections IDB store — `InspectionForm` (every save tick), `useAutoSync.safePostSyncSave`, `atomic-sync-manager`, `local-backup-ledger`, restore tools — passes the bare row with **no** `inspector` field, overwriting the join.
- Dashboard renders stale-while-revalidate from IDB first, so during/after editing a draft the card sees `report.inspector === undefined` → falls through to `'Unknown'`.

## Fix (Option B — non-mutating, profile lookup map)

A small `Map<inspector_id, ProfileData>` is built at the dashboard level, seeded from any rows that already carry the join, and lazily filled from the existing `getCachedProfile` for ids that don't. The map is passed down to the cards and to the assignee resolver so the display name no longer depends on whether the IDB row happens to carry the join.

### Files changed

1. **`src/hooks/useProfileMap.tsx`** *(new)*
   - `useProfileMap(reports)` returns `Map<inspector_id, ProfileData>`.
   - Synchronous seed: walks `reports` and stores `{ first_name, last_name, avatar_url }` for every row that has `row.trainer` (trainings) or `row.inspector` (inspections / daily).
   - Async fill: for any `inspector_id` still missing, calls `getCachedProfile(id)` (in-memory → localStorage → DB w/ 5s timeout — already implemented). Triggers a single re-render once all missing profiles are resolved.

2. **`src/lib/report-utils.ts`**
   - Extend `getAssigneeName(report, type, profilesById?: Map<string, { first_name?, last_name? }>)`.
   - When `report.inspector` / `report.trainer` join is missing, fall back to `profilesById.get(report.inspector_id)`. Final fallback stays `'Unknown'`.

3. **`src/components/dashboard/ReportCard.tsx`**
   - Add optional `profilesById?: Map<string, ProfileData>` prop.
   - `getInspectorName`, `getInspectorAvatar`, `getInspectorInitials` look up `profilesById.get(report.inspector_id)` whenever the row's join is empty.
   - No visual changes when the map is absent — still shows `'Unknown'` (backwards compatible).

4. **`src/components/dashboard/DashboardReportsSection.tsx`**
   - Add optional `profilesById` to props; thread it into the three `<ReportCard ... />` call sites (two in main list, one in `CrossTabSection`).
   - Pass it into `useDashboardFilters` so sort-by-assignee uses the resolved name.

5. **`src/hooks/useDashboardFilters.tsx`**
   - Accept optional `profilesById` and pass it through to `getAssigneeName(...)` calls used in search and the `assignee` sort comparator.

6. **`src/pages/Dashboard.tsx`**
   - Build one shared map: `const profilesById = useProfileMap(useMemo(() => [...inspections, ...trainings, ...dailyAssessments], [inspections, trainings, dailyAssessments]))`.
   - Pass `profilesById` to `<DashboardReportsSection />`.

## Why this works for every "Unknown" path

- **Locally edited draft after a save** — IDB row lost the join → map still has it from any prior server fetch; otherwise `getCachedProfile` resolves the user and updates the map.
- **First paint from cold IDB cache (offline)** — `getCachedProfile` reads `localStorage` (`cached_profile_<id>`) which `useUserProfile` and prior network calls have already populated for the signed-in user.
- **Other inspectors on a super-admin dashboard** — the join from any successful `loadInspections` round seeds those ids into the map; reloads keep them resolved across renders because `mapRef` is stable.
- **No DB or schema changes.** No row mutation. No regressions for existing rows that already have the join — they continue to render exactly as today.

## Out of scope

- Changing the sync/save writers to preserve the `inspector` join (would be invasive across 8+ call sites and add stale-profile risk).
- Backfilling old IDB rows with profile data.

## Verification after the fix

- Open dashboard online with drafts in IDB → cards show real names immediately (synchronous seed).
- Hard-refresh offline → cards show real names (resolved from `localStorage` profile cache).
- Edit a draft, return to dashboard → name stays correct (was previously the regression trigger).
- Sort-by-assignee groups by resolved name, not by `'Unknown'`.
